import { spawn } from 'node:child_process';
import { open, readFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeOptions, offlineUuid, readManifest, resolveVersion, writeJson } from './core.js';
import { atomicWrite } from './download.js';
import { install } from './install.js';
import { acquireLock, identity, running, stopClient, type RunningClient } from './process.js';

export const CONTROL_URL = 'http://127.0.0.1:8765/control';
export const controlUrl = (port = 8765) => `http://127.0.0.1:${port}/control`;

export async function command(name: string, arguments_: Record<string, unknown> = {}, url = CONTROL_URL, timeoutMs = 35_000): Promise<any> {
  const response = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json',
      ...(process.env.MINECRAFT_CONTROL_TOKEN ? { Authorization: `Bearer ${process.env.MINECRAFT_CONTROL_TOKEN}` } : {}) },
    body: JSON.stringify({ command: name, arguments: arguments_ }),
  });
  let result: any;
  try { result = await response.json(); } catch { throw new Error(`Control endpoint returned HTTP ${response.status}.`); }
  if (!result || typeof result !== 'object') throw new Error('Control endpoint returned an invalid response.');
  if (!response.ok || result.error) throw new Error(typeof result.error === 'string' ? result.error : `Control endpoint returned HTTP ${response.status}.`);
  return result;
}

export async function controlReady(url = CONTROL_URL): Promise<void> {
  const healthUrl = new URL(url);
  healthUrl.pathname = '/health';
  const response = await fetch(healthUrl, {
    signal: AbortSignal.timeout(5000),
    headers: process.env.MINECRAFT_CONTROL_TOKEN ? { Authorization: `Bearer ${process.env.MINECRAFT_CONTROL_TOKEN}` } : {},
  });
  if (!response.ok) throw new Error(`Minecraft command endpoint returned HTTP ${response.status}.`);
  const result = await response.json() as { ready?: boolean };
  if (result.ready !== true) throw new Error('Minecraft command endpoint is not ready.');
}

export async function requireFreePort(port = 8765): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createServer();
    socket.once('error', () => reject(new Error(`Control port ${port} is occupied. Choose another free port with --port.`)));
    socket.listen(port, '127.0.0.1', () => socket.close(error => error ? reject(error) : resolve()));
  });
}

export function validateControlPort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 18765) {
    throw new Error('Port must be an integer from 1024 to 65535, excluding mutex port 18765.');
  }
}

export async function launch(root: string, packageRoot: string, requested: string | undefined, username: string,
  progress: (message: string) => void, port = 8765, background = true): Promise<RunningClient> {
  validateControlPort(port);
  const url = controlUrl(port);
  const manifest = await readManifest(packageRoot);
  const { version, compatibility } = resolveVersion(manifest, requested);
  const uuid = offlineUuid(username);
  const release = await acquireLock(root);
  let record: RunningClient | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let childError: Error | undefined;
  try {
    const active = await running(root);
    if (active) throw new Error(`Minecraft ${active.version} is already running. Run minecraft status or minecraft stop.`);
    await requireFreePort(port);
    const mod = await readFile(path.resolve(packageRoot, compatibility.mod.file));
    if (createHash('sha256').update(mod).digest('hex') !== compatibility.mod.sha256) throw new Error('Bundled mod checksum does not match the compatibility manifest.');
    const installation = await install(root, version, compatibility, progress);
    await initializeOptions(installation.instance, version, installation.optionsDataVersion);
    await atomicWrite(path.join(installation.instance, 'mods', 'minecraft-control.jar'), mod);
    await rm(path.join(installation.instance, 'mods', 'minecraft-mcp.jar'), { force: true });
    // Downloads can take time. Check again immediately before creating the process.
    await requireFreePort(port);
    const log = path.join(installation.instance, 'launcher.log');
    await mkdir(path.dirname(log), { recursive: true });
    const output = await open(log, 'w');
    try {
      child = spawn(installation.java, installation.launch(username, uuid, port, background), {
        cwd: installation.instance, detached: true, windowsHide: false, stdio: ['ignore', output.fd, output.fd],
      });
      child.on('error', error => { childError = error; });
    } finally { await output.close(); }
    if (!child.pid) throw new Error(`Could not start Minecraft. See ${log}`);
    const processIdentity = await identity(child.pid);
    if (!processIdentity) throw new Error(`Minecraft exited during startup. See ${log}`);
    record = { identity: processIdentity, version, instance: installation.instance, log, port };
    await writeJson(path.join(root, 'client.json'), record);
    progress(`Waiting for Minecraft command endpoint. Startup log ${log}`);
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (childError || child.exitCode !== null || child.signalCode !== null) throw new Error(`Minecraft exited during startup. See ${log}`, { cause: childError });
      try { await controlReady(url); child.unref(); return record; } catch { await delay(1000); }
    }
    throw new Error(`Minecraft command endpoint did not become ready within 180 seconds. See ${log}`);
  } catch (error) {
    if (record) { await stopClient(record); await rm(path.join(root, 'client.json'), { force: true }); }
    else if (child && child.exitCode === null && child.signalCode === null) child.kill();
    throw error;
  } finally { await release(); }
}

export async function stop(root: string): Promise<{ stopped: boolean }> {
  const release = await acquireLock(root);
  try {
    const record = await running(root);
    if (!record) return { stopped: false };
    const url = controlUrl(record.port);
    let ready = false;
    try { await controlReady(url); ready = true; } catch { /* The process may be starting or exiting. */ }
    if (ready) {
      let recording = false;
      try { recording = (await command('state', {}, url)).recording === true; } catch { /* Fall back to the normal window close. */ }
      if (recording) await command('record', { action: 'stop' }, url, 125_000);
    }
    await stopClient(record);
    for (let count = 0; count < 30; count++) {
      if (!(await running(root))) {
        await rm(path.join(root, 'client.json'), { force: true });
        return { stopped: true };
      }
      await delay(100);
    }
    throw new Error('The managed Minecraft process did not stop.');
  } finally { await release(); }
}
