import http from 'node:http';
import net from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer, createWebSocketStream } from 'ws';

const entrypoint = fileURLToPath(new URL('./index.js', import.meta.url));

export function tunnelConnection(value: string): { url: URL; token: string } {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new Error('TUNNEL must use HTTPS, or HTTP on localhost.');
  }
  const token = url.hash.slice(1);
  if (!/^[a-f0-9]{64}$/.test(token) || url.username || url.password || url.search || url.pathname !== '/') {
    throw new Error('Use the complete TUNNEL URL printed by minecraft host launch, including its #token.');
  }
  url.hash = '';
  return { url, token };
}

export function authorized(header: string | undefined, token: string): boolean {
  const actual = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validateRemoteArgs(args: unknown): asserts args is string[] {
  if (!Array.isArray(args) || !args.length || args.some(arg => typeof arg !== 'string') || args.length > 100) throw new Error('Invalid command arguments.');
  if (!['versions', 'launch', 'status', 'stop', 'control', 'server'].includes(args[0])) throw new Error('This command cannot run remotely.');
  if (args.includes('--foreground')) throw new Error('Remote clients run in the background. Omit --foreground.');
}

export function createHost(token: string, sshPort = 22) {
  const sockets = new Set<net.Socket>();
  const children = new Set<ReturnType<typeof spawn>>();
  const server = http.createServer(async (request, response) => {
    if (!authorized(request.headers.authorization, token)) { response.writeHead(401).end('Unauthorized'); return; }
    if (request.method !== 'POST' || request.url !== '/command') { response.writeHead(404).end(); return; }
    let temporary: string | undefined;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) { response.writeHead(413).end('Command too large'); return; }
        chunks.push(chunk);
      }
      const args: unknown = JSON.parse(Buffer.concat(chunks).toString());
      validateRemoteArgs(args);
      const screenshot = args[0] === 'control' && args[1] === 'screenshot';
      if (screenshot) {
        temporary = await mkdtemp(path.join(os.tmpdir(), 'minecraft-screenshot-'));
        const output = args.findIndex(arg => arg === '--output' || arg.startsWith('--output='));
        if (output >= 0) args.splice(output, args[output]!.includes('=') ? 1 : 2);
        args.push('--output', path.join(temporary, 'screenshot.png'));
      }
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      const emit = (event: object) => { if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`); };
      const keepalive = setInterval(() => emit({}), 15_000);
      const env = { ...process.env };
      delete env.TUNNEL;
      const child = spawn(process.execPath, [entrypoint, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      children.add(child);
      const disconnect = () => { if (child.exitCode === null) child.kill(); };
      response.on('close', disconnect);
      // A streaming decoder keeps multibyte command output intact across chunks.
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', data => { if (!screenshot) emit({ stdout: data }); });
      child.stderr.on('data', data => emit({ stderr: data }));
      try {
        const code = await new Promise<number>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', code => resolve(code ?? 1));
        });
        if (screenshot && code === 0) {
          const data = await readFile(path.join(temporary!, 'screenshot.png'));
          emit({ screenshot: data.toString('base64') });
        }
        emit({ code });
      } finally {
        clearInterval(keepalive);
        children.delete(child);
        response.off('close', disconnect);
      }
      response.end();
    } catch (error) {
      if (!response.headersSent) response.writeHead(400);
      response.end(`${JSON.stringify({ stderr: `${(error as Error).message}\n`, code: 1 })}\n`);
    } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
  });
  const websocket = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1024 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ssh' || !authorized(request.headers.authorization, token)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
    }
    websocket.handleUpgrade(request, socket, head, ws => {
      const tcp = net.connect({ host: '127.0.0.1', port: sshPort });
      sockets.add(tcp);
      const stream = createWebSocketStream(ws);
      stream.on('error', () => tcp.destroy());
      tcp.on('error', () => stream.destroy());
      tcp.on('close', () => { sockets.delete(tcp); stream.destroy(); });
      stream.on('close', () => tcp.destroy());
      tcp.pipe(stream).pipe(tcp);
    });
  });
  return { server, close: async () => {
    for (const child of children) child.kill();
    for (const socket of sockets) socket.destroy();
    for (const ws of websocket.clients) ws.terminate();
    websocket.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

export async function launchHost(sshPort: number, localOnly = false): Promise<void> {
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new Error('SSH port must be between 1 and 65535.');
  const token = randomBytes(32).toString('hex');
  const host = createHost(token, sshPort);
  await new Promise<void>((resolve, reject) => {
    host.server.once('error', reject);
    host.server.listen(0, '127.0.0.1', resolve);
  });
  const address = host.server.address() as net.AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  if (localOnly) { console.log(`TUNNEL=${origin}/#${token}`); }
  const tunnel = localOnly ? undefined : spawn('cloudflared', ['tunnel', '--url', origin, '--no-autoupdate', '--protocol', 'http2'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let printed = localOnly;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(startup);
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
    tunnel?.kill();
    await host.close();
  };
  const signal = () => { void shutdown(); };
  const startup = setTimeout(() => {
    if (!printed) { console.error('Tunnel startup timed out. Check cloudflared and network access.'); process.exitCode = 1; void shutdown(); }
  }, 60_000);
  startup.unref();
  tunnel?.stderr.setEncoding('utf8');
  let logs = '';
  let tunnelUrl: string | undefined;
  tunnel?.stderr.on('data', (chunk: string) => {
    process.stderr.write(chunk);
    logs = (logs + chunk).slice(-8192);
    const url = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (url) tunnelUrl = url[0];
    if (tunnelUrl && logs.includes('Registered tunnel connection') && !printed) {
      printed = true; clearTimeout(startup); console.log(`TUNNEL=${tunnelUrl}/#${token}`);
    }
  });
  tunnel?.once('error', () => {
    console.error('Could not start cloudflared. Install it and add it to PATH, then run minecraft host launch again.');
    process.exitCode = 1; void shutdown();
  });
  tunnel?.once('exit', () => {
    if (!stopping) { console.error('The tunnel stopped. Restart minecraft host launch to reconnect.'); process.exitCode = 1; void shutdown(); }
  });
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
}

export async function remoteCommand(value: string, args: string[]): Promise<number> {
  validateRemoteArgs(args);
  const { url, token } = tunnelConnection(value);
  const response = await fetch(new URL('command', url), {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(30 * 60_000), redirect: 'error',
  });
  if (!response.ok || !response.body) throw new Error(`Host command failed with HTTP ${response.status}.`);
  let pending = '';
  let code: number | undefined;
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (typeof event.stdout === 'string') process.stdout.write(event.stdout);
      if (typeof event.stderr === 'string') process.stderr.write(event.stderr);
      if (typeof event.screenshot === 'string') {
        const index = args.indexOf('--output');
        const output = args.find(arg => arg.startsWith('--output='))?.slice(9) ?? (index >= 0 ? args[index + 1] : undefined);
        const file = path.resolve(output ?? `minecraft-screenshot-${Date.now()}.png`);
        await writeFile(file, Buffer.from(event.screenshot, 'base64'));
        console.log(JSON.stringify({ screenshot: file, mimeType: 'image/png' }));
      }
      if (typeof event.code === 'number') code = event.code;
    }
  }
  if (code === undefined) throw new Error('The host disconnected before the command completed.');
  return code;
}

export async function sshProxy(value: string): Promise<void> {
  const { url, token } = tunnelConnection(value);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ssh';
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, followRedirects: false, handshakeTimeout: 15_000 });
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const stream = createWebSocketStream(ws);
  stream.on('error', error => { console.error(`SSH tunnel failed. ${error.message}`); process.exitCode = 1; });
  stream.on('close', () => { process.stdin.unpipe(stream); process.stdin.pause(); });
  process.stdin.pipe(stream).pipe(process.stdout);
}
