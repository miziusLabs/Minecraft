import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { authorized } from './host.js';

async function main() {
  const [directory, java, version] = process.argv.slice(2);
  if (!directory || !java || !version || !process.send) throw new Error('Start servers with minecraft server launch.');
  const token = randomBytes(32).toString('hex');
  const record = path.join(directory, 'server.json');
  let ready = false;
  let stopping = false;
  let child: ReturnType<typeof spawn> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let resolveExit: () => void;
  const exited = new Promise<void>(resolve => { resolveExit = resolve; });
  const status = () => ({ running: !!child && child.exitCode === null && child.signalCode === null, ready, version, directory, log: path.join(directory, 'console.log'), pid: child?.pid });
  const stop = async () => {
    if (!stopping && child) {
      stopping = true;
      child.stdin?.write('stop\n');
      timer = setTimeout(() => child?.kill('SIGKILL'), 45_000);
    }
    await exited;
  };
  const server = http.createServer(async (request, response) => {
    if (!authorized(request.headers.authorization, token)) { response.writeHead(401).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    try {
      if (request.url === '/status') { response.end(JSON.stringify(status())); return; }
      if (request.url === '/stop') { await stop(); response.end(JSON.stringify({ stopped: true })); return; }
      if (request.url !== '/command') { response.writeHead(404).end(); return; }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 16_384) { response.writeHead(413).end(); return; }
      }
      const { command } = JSON.parse(body);
      if (typeof command !== 'string' || !command.trim() || /[\r\n\0]/.test(command)) throw new Error('Supply one nonempty server console command.');
      if (stopping || !status().running) throw new Error('The server is stopping or has stopped.');
      child!.stdin!.write(`${command.replace(/^\//, '')}\n`);
      response.end(JSON.stringify({ sent: true, command }));
    } catch (error) { response.writeHead(400).end((error as Error).message); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  child = spawn(java, ['-jar', 'server.jar', 'nogui'], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  // Java owns no inherited terminal, so a launching CLI or tunnel can disconnect safely.
  let recent = '';
  const output = (chunk: Buffer) => {
    process.stdout.write(chunk);
    recent = (recent + chunk.toString()).slice(-4096);
    if (/Done \([^)]+\)!/.test(recent)) ready = true;
  };
  child.stdout!.on('data', output);
  child.stderr!.on('data', output);
  child.stdin!.on('error', () => { /* The process can exit before a stop command is delivered. */ });
  child.once('error', error => { console.error(error.message); });
  child.once('close', async () => {
    ready = false;
    if (timer) clearTimeout(timer);
    try {
      const current = JSON.parse(await readFile(record, 'utf8'));
      if (current.token === token) await rm(record, { force: true });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(error); }
    resolveExit!();
    server.close();
  });
  await new Promise<void>((resolve, reject) => { child!.once('spawn', resolve); child!.once('error', reject); });
  await writeFile(record, JSON.stringify({ port: (server.address() as AddressInfo).port, token }), { mode: 0o600 });
  process.send!(status());
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
}

main().catch(error => {
  process.send?.({ error: (error as Error).message });
  console.error(error);
  process.exit(1);
});
