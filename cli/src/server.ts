import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { acquireLock } from './process.js';
import { fetchJson, download, type Download } from './download.js';

export type ServerSoftware = 'vanilla' | 'paper' | 'folia';

export interface ServerOptions {
  version: string;
  reset?: boolean;
  acceptEula?: boolean;
  port?: number;
  software?: ServerSoftware;
}

export function serverVersion(spec: string, software?: ServerSoftware): { version: string; software: ServerSoftware } {
  const parts = spec.split('/');
  const name = parts.length === 2 ? parts[0]!.toLowerCase() : undefined;
  if (parts.length > 2 || (name !== undefined && !['vanilla', 'paper', 'folia'].includes(name))) throw new Error('Use a Minecraft version or Paper/<version>, Folia/<version>, or Vanilla/<version>.');
  if (software !== undefined && !['vanilla', 'paper', 'folia'].includes(software)) throw new Error('Server software must be vanilla, paper, or folia.');
  if (name && software && name !== software) throw new Error('--software conflicts with the software in --version.');
  const version = parts.at(-1)!;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(version)) throw new Error('Invalid Minecraft server version.');
  return { version, software: (name as ServerSoftware | undefined) ?? software ?? 'paper' };
}

export function serverDirectory(root: string, spec: string, software?: ServerSoftware): string {
  const selected = serverVersion(spec, software);
  const label = selected.software[0]!.toUpperCase() + selected.software.slice(1);
  return path.join(root, 'servers', label, selected.version);
}

function findJava(required: number): string {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  const homes = [`JAVA_${required}_HOME`, `JDK_${required}_HOME`, `JAVA${required}_HOME`, `JDK${required}_HOME`, 'JAVA_HOME'];
  const candidates = process.env.MINECRAFT_JAVA ? [process.env.MINECRAFT_JAVA] : [
    ...homes.flatMap(name => process.env[name] ? [path.join(process.env[name]!, 'bin', executable)] : []), 'java',
  ];
  for (const candidate of candidates) {
    const check = spawnSync(candidate, ['-version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
    const major = /version "(?:1\.)?(\d+)/.exec(`${check.stderr}${check.stdout}`)?.[1];
    if (!check.error && check.status === 0 && major && Number(major) >= required) return candidate;
  }
  throw new Error(`Install Java ${required} or newer and set JAVA_${required}_HOME, JAVA_HOME, or MINECRAFT_JAVA to use it.`);
}

interface ServerRecord { port: number; token: string }
interface ServerResult {
  running?: boolean;
  ready?: boolean;
  sent?: boolean;
  stopped?: boolean;
  forced?: boolean;
  version?: string;
  directory?: string;
  log?: string;
  pid?: number;
  command?: string;
}

export async function serverRequest(directory: string, action: string, command?: string): Promise<ServerResult> {
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
      body: JSON.stringify({ command }), signal: AbortSignal.timeout(action === 'stop' ? 140_000 : 5000), redirect: 'error',
    });
  } catch (error) {
    if ((error as Error & { cause?: NodeJS.ErrnoException }).cause?.code === 'ECONNREFUSED') return { running: false, ready: false };
    throw error;
  }
  if (!response.ok) throw new Error(`Server ${action} failed. ${await response.text()}`);
  return response.json();
}

async function withServerLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const release = await acquireLock(root, 18766);
  try { return await action(); } finally { await release(); }
}

export async function launchServer(root: string, options: ServerOptions, restart = false): Promise<unknown> {
  const { version: minecraftVersion, software } = serverVersion(options.version, options.software);
  const directory = serverDirectory(root, options.version, options.software);
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535 || [18765, 18766].includes(options.port))) throw new Error('Server port must be between 1 and 65535, excluding mutex ports 18765 and 18766.');
  return withServerLock(root, async () => {
    const current = await serverRequest(directory, 'status');
    if (current.running && !restart) throw new Error(`Minecraft server ${options.version} is already running.`);
    const configPath = path.join(directory, 'managed-server.json');
    let previous: { software: ServerSoftware; version: string; source: Download } | undefined;
    try { previous = JSON.parse(await readFile(configPath, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let eula = false;
    try { eula = /^\s*eula\s*=\s*true\s*$/m.test(await readFile(path.join(directory, 'eula.txt'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!options.acceptEula && !eula) throw new Error('Read https://aka.ms/MinecraftEULA and pass --accept-eula if you agree, or set eula=true in this server folder.');
    const manifest = await fetchJson<{ versions: Array<{ id: string; url: string; sha1: string }> }>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const entry = manifest.versions.find(item => item.id === minecraftVersion);
    if (!entry) throw new Error(`Minecraft ${options.version} is absent from Mojang's version manifest.`);
    const version = await fetchJson<{ downloads: { server?: { url: string; sha1: string; size: number } }; javaVersion?: { majorVersion: number } }>(entry.url);
    if (!version.downloads.server) throw new Error(`Minecraft ${options.version} has no server download.`);
    let source: Download = version.downloads.server;
    if (software !== 'vanilla') {
      if (!options.reset && previous?.software === software && previous.version === minecraftVersion) source = previous.source;
      else {
        const response = await fetch(`https://fill.papermc.io/v3/projects/${software}/versions/${encodeURIComponent(minecraftVersion)}/builds/latest`, {
          headers: { 'User-Agent': 'mizius-minecraft (https://github.com/miziusLabs/Minecraft)' }, signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`${software} ${minecraftVersion} is unavailable. HTTP ${response.status}.`);
        const build = await response.json() as { downloads: Record<string, { url: string; checksums: { sha256: string }; size: number }> };
        const artifact = build.downloads['server:default'];
        if (!artifact?.checksums.sha256) throw new Error('The publisher did not provide a verified server download.');
        source = { url: artifact.url, sha256: artifact.checksums.sha256, size: artifact.size };
      }
    }
    const java = findJava(version.javaVersion?.majorVersion ?? 8);
    if (current.running) await serverRequest(directory, 'stop');
    if (options.reset) await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    if (software !== 'vanilla') await mkdir(path.join(directory, 'plugins'), { recursive: true });
    await download(path.join(directory, 'server.jar'), source);
    await writeFile(configPath, JSON.stringify({ software, version: minecraftVersion, source }, null, 2));
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
      const worker = fork(fileURLToPath(new URL('./server-worker.js', import.meta.url)), [directory, java, `${software}/${minecraftVersion}`], {
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

export async function stopServer(root: string, version: string, software?: ServerSoftware): Promise<unknown> {
  const directory = serverDirectory(root, version, software);
  return withServerLock(root, () => serverRequest(directory, 'stop'));
}
