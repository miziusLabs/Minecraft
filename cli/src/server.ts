import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { fetchJson, download } from './download.js';

export interface ServerOptions {
  version: string;
  reset?: boolean;
  acceptEula?: boolean;
  port?: number;
}

export function serverDirectory(root: string, version: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(version)) throw new Error('Invalid Minecraft server version.');
  return path.join(root, 'servers', version);
}

interface ServerRecord { port: number; token: string }

export async function serverRequest(directory: string, action: string, command?: string): Promise<any> {
  let record: ServerRecord;
  try { record = JSON.parse(await readFile(path.join(directory, 'server.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { running: false, ready: false };
    throw error;
  }
  if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535 || !/^[a-f0-9]{64}$/.test(record.token)) throw new Error('Invalid server process record.');
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${record.port}/${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${record.token}` },
      body: JSON.stringify({ command }), signal: AbortSignal.timeout(action === 'stop' ? 65_000 : 5000), redirect: 'error',
    });
  } catch (error) {
    if ((error as Error & { cause?: NodeJS.ErrnoException }).cause?.code === 'ECONNREFUSED') return { running: false, ready: false };
    throw error;
  }
  if (!response.ok) throw new Error(`Server ${action} failed. ${await response.text()}`);
  return response.json();
}

async function withServerLock<T>(root: string, version: string, action: () => Promise<T>): Promise<T> {
  const locks = path.join(root, 'servers', '.locks');
  await mkdir(locks, { recursive: true });
  const file = path.join(locks, `${version}.json`);
  let handle;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { handle = await open(file, 'wx', 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let pid: number;
      try { pid = JSON.parse(await readFile(file, 'utf8')).pid; }
      catch { throw new Error('Another server operation is starting. Try again shortly.'); }
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid server lock.');
      try { process.kill(pid, 0); throw new Error('Another server operation is in progress.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      await rm(file, { force: true });
    }
  }
  if (!handle) throw new Error('Could not acquire the server lock.');
  try { await handle.writeFile(JSON.stringify({ pid: process.pid })); return await action(); }
  finally { await handle.close(); await rm(file, { force: true }); }
}

export async function launchServer(root: string, options: ServerOptions, restart = false): Promise<unknown> {
  const directory = serverDirectory(root, options.version);
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) throw new Error('Server port must be between 1 and 65535.');
  return withServerLock(root, options.version, async () => {
    const current = await serverRequest(directory, 'status');
    if (current.running) {
      if (!restart) throw new Error(`Minecraft server ${options.version} is already running.`);
      await serverRequest(directory, 'stop');
    }
    let eula = false;
    try { eula = /^\s*eula\s*=\s*true\s*$/m.test(await readFile(path.join(directory, 'eula.txt'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!options.acceptEula && !eula) throw new Error('Read https://aka.ms/MinecraftEULA and pass --accept-eula if you agree, or set eula=true in this server folder.');
    const manifest = await fetchJson<{ versions: Array<{ id: string; url: string; sha1: string }> }>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const entry = manifest.versions.find(item => item.id === options.version);
    if (!entry) throw new Error(`Minecraft ${options.version} is absent from Mojang's version manifest.`);
    const version = await fetchJson<{ downloads: { server?: { url: string; sha1: string; size: number } }; javaVersion?: { majorVersion: number } }>(entry.url);
    if (!version.downloads.server) throw new Error(`Minecraft ${options.version} has no server download.`);
    const java = process.env.MINECRAFT_JAVA ?? (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java');
    const check = spawnSync(java, ['-version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
    const major = /version "(?:1\.)?(\d+)/.exec(`${check.stderr}${check.stdout}`)?.[1];
    const required = version.javaVersion?.majorVersion ?? 8;
    if (check.error || check.status !== 0 || !major || Number(major) < required) throw new Error(`Install Java ${required} or newer and set JAVA_HOME or MINECRAFT_JAVA to use it.`);
    if (options.reset) await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    await download(version.downloads.server, path.join(directory, 'server.jar'));
    if (options.acceptEula || (options.reset && eula)) await writeFile(path.join(directory, 'eula.txt'), 'eula=true\n');
    if (options.port !== undefined) {
      const properties = path.join(directory, 'server.properties');
      let content = '';
      try { content = await readFile(properties, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      content = content.replace(/^server-port\s*[=:].*\r?\n?/gm, '');
      await writeFile(properties, `${content.trimEnd()}\nserver-port=${options.port}\n`);
    }
    const log = await open(path.join(directory, 'console.log'), 'a');
    try {
      const worker = fork(fileURLToPath(new URL('./server-worker.js', import.meta.url)), [directory, java, options.version], {
        detached: true, stdio: ['ignore', log.fd, log.fd, 'ipc'], execArgv: [], windowsHide: true,
      });
      try {
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { worker.kill(); reject(new Error('Server manager startup timed out. Check console.log.')); }, 15_000);
          const done = () => { clearTimeout(timeout); worker.disconnect(); worker.unref(); };
          worker.once('error', error => { clearTimeout(timeout); reject(error); });
          worker.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server manager exited with code ${code}. Check console.log.`)); });
          worker.once('message', message => {
            done();
            const result = message as { error?: string };
            if (result.error) reject(new Error(result.error)); else resolve(result);
          });
        });
      } catch (error) { worker.unref(); throw error; }
    } finally { await log.close(); }
  });
}

export async function stopServer(root: string, version: string): Promise<unknown> {
  const directory = serverDirectory(root, version);
  return withServerLock(root, version, () => serverRequest(directory, 'stop'));
}
