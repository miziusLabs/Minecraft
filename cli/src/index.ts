#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { readManifest } from './core.js';
import { command as controlCommand, controlReady, controlUrl, launch, stop } from './launch.js';
import { running } from './process.js';
import type { RunningClient } from './process.js';

function describe(record: RunningClient) {
  return { pid: record.identity.pid, version: record.version, instance: record.instance, log: record.log, port: record.port };
}

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const help = `Minecraft command line

  minecraft versions [--json]
  minecraft launch [version] [--username Agent] [--port 8765] [--foreground] [--json]
  minecraft status [--json]
  minecraft stop [--json]
  minecraft control state [--json]
  minecraft control screenshot [--output <file>] [--json]
  minecraft control join <server-address> [--json]
  minecraft control click <x> <y> [--button left|right|middle] [--action press|hold|release] [--json]
  minecraft control move <x> <y> [--json]
  minecraft control drag <x1> <y1> <x2> <y2> [--button left|right|middle] [--duration-ms 250] [--json]
  minecraft control scroll <amount> [--json]
  minecraft control key <key-name-or-code> [--action press|hold|release] [--json]
  minecraft control type <text> [--json]
  minecraft control execute <command> [--json]
  minecraft control logs [query] [--limit 100] [--json]
  minecraft control batch <json-array> [--json]
  minecraft skill path
  minecraft skill install --dir <skills-directory>

The managed client requires Windows x64. The command endpoint runs inside the game client.
Use mizius_minecraft_home to select a different managed directory.
`;

function integer(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (value === undefined || !Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`);
  return parsed;
}

function coordinate(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (value === undefined || !Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

function requireClientPlatform(): void {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Managed Minecraft currently requires Windows x64.');
}

function managedRoot(): string {
  const base = process.env.mizius_minecraft_home ?? (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'mizius', 'Minecraft'));
  if (!base) throw new Error('LOCALAPPDATA is unavailable. Set mizius_minecraft_home to a managed directory.');
  return path.resolve(base);
}

async function sendCommand(root: string, name: string, args: Record<string, unknown> = {}) {
  requireClientPlatform();
  const record = await running(root);
  if (!record) throw new Error('Minecraft is not running. Run minecraft launch first.');
  const url = controlUrl(record.port);
  await controlReady(url);
  return controlCommand(name, args, url, name === 'screenshot' ? 30_000 : 35_000);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, strict: true, options: {
    json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    username: { type: 'string' }, dir: { type: 'string' }, port: { type: 'string' }, foreground: { type: 'boolean' },
    output: { type: 'string' }, button: { type: 'string' }, action: { type: 'string' },
    'duration-ms': { type: 'string' }, limit: { type: 'string' },
  } });
  if (values.help || positionals.length === 0) { console.log(help); return; }
  const [topLevel, second, ...remaining] = positionals;
  const isControl = topLevel === 'control';
  const commandName = isControl ? second : topLevel;
  const argument = isControl ? remaining[0] : second;
  const rest = isControl ? remaining.slice(1) : remaining;
  const output = (value: unknown) => console.log(JSON.stringify(value, null, values.json ? undefined : 2));
  if (commandName === 'skill') {
    if (positionals.length !== 2) throw new Error('Use minecraft skill path or minecraft skill install --dir <skills-directory>.');
    const source = path.join(packageRoot, 'skills', 'minecraft', 'SKILL.md');
    if (argument === 'path') { console.log(path.dirname(source)); return; }
    if (argument !== 'install' || !values.dir) throw new Error('Use minecraft skill install --dir <skills-directory>.');
    const directory = path.resolve(values.dir, 'minecraft');
    await mkdir(directory, { recursive: true });
    await copyFile(source, path.join(directory, 'SKILL.md'), 1);
    output({ installed: directory }); return;
  }
  if (commandName === 'versions') {
    if (positionals.length !== 1) throw new Error('Use minecraft versions.');
    const manifest = await readManifest(packageRoot);
    output({ defaultVersion: manifest.defaultVersion, versions: Object.keys(manifest.versions) }); return;
  }
  if (isControl ? !['state', 'screenshot', 'join', 'click', 'move', 'drag', 'scroll', 'key', 'type', 'execute', 'logs', 'batch'].includes(commandName ?? '') : !['launch', 'status', 'stop'].includes(commandName ?? '')) {
    throw new Error(isControl ? `Unknown control command ${commandName}. Run minecraft --help.` : `Unknown command ${commandName}. Run minecraft --help.`);
  }
  requireClientPlatform();
  const root = managedRoot();
  if (commandName === 'launch') {
    if (rest.length) throw new Error('Use minecraft launch [version].');
    output(describe(await launch(root, packageRoot, argument, values.username ?? 'Agent', message => console.error(message), values.port === undefined ? 8765 : Number(values.port), !values.foreground))); return;
  }
  if (commandName === 'stop') {
    if (argument !== undefined) throw new Error('Use minecraft stop.');
    output(await stop(root)); return;
  }
  if (commandName === 'status') {
    if (argument !== undefined) throw new Error('Use minecraft status.');
    try { await access(root); } catch { output({ running: false, ready: false }); return; }
    const record = await running(root);
    let ready = false;
    if (record) { try { await controlReady(controlUrl(record.port)); ready = true; } catch { /* The process may still be starting. */ } }
    output({ running: !!record, ready, ...(record ? describe(record) : {}) }); return;
  }
  if (commandName === 'state') {
    if (argument !== undefined) throw new Error('Use minecraft control state.');
    output(await sendCommand(root, 'state')); return;
  }
  if (commandName === 'batch') {
    if (argument === undefined || rest.length) throw new Error('Use minecraft control batch <json-array>.');
    let actions: unknown;
    try { actions = JSON.parse(argument); } catch { throw new Error('The batch argument must be valid JSON.'); }
    if (!Array.isArray(actions)) throw new Error('The batch argument must be a JSON array.');
    output(await sendCommand(root, 'batch', { actions })); return;
  }
  if (commandName === 'screenshot') {
    if (argument !== undefined) throw new Error('Use minecraft control screenshot [--output <file>].');
    const result = await sendCommand(root, 'screenshot');
    if (result.mimeType !== 'image/png' || typeof result.data !== 'string') throw new Error('The game did not return a PNG screenshot.');
    const file = path.resolve(values.output ?? `minecraft-screenshot-${new Date().toISOString().replaceAll(':', '-')}.png`);
    await writeFile(file, Buffer.from(result.data, 'base64'));
    output({ screenshot: file, mimeType: result.mimeType }); return;
  }
  if (commandName === 'join') {
    if (!argument || rest.length) throw new Error('Use minecraft control join <server-address>.');
    output(await sendCommand(root, 'join', { ip: argument })); return;
  }
  if (commandName === 'click') {
    if (rest.length !== 1) throw new Error('Use minecraft control click <x> <y>.');
    output(await sendCommand(root, 'click', { x: coordinate(argument, 'x'), y: coordinate(rest[0], 'y'), button: values.button ?? 'left', action: values.action ?? 'press' })); return;
  }
  if (commandName === 'move') {
    if (rest.length !== 1) throw new Error('Use minecraft control move <x> <y>.');
    output(await sendCommand(root, 'move', { x: coordinate(argument, 'x'), y: coordinate(rest[0], 'y') })); return;
  }
  if (commandName === 'drag') {
    if (rest.length !== 3) throw new Error('Use minecraft control drag <x1> <y1> <x2> <y2>.');
    output(await sendCommand(root, 'drag', {
      from: { x: coordinate(argument, 'x1'), y: coordinate(rest[0], 'y1') },
      to: { x: coordinate(rest[1], 'x2'), y: coordinate(rest[2], 'y2') },
      button: values.button ?? 'left',
      ...(values['duration-ms'] === undefined ? {} : { duration_ms: integer(values['duration-ms'], 'duration-ms') }),
    })); return;
  }
  if (commandName === 'scroll') {
    if (rest.length) throw new Error('Use minecraft control scroll <amount>.');
    output(await sendCommand(root, 'scroll', { amount: coordinate(argument, 'amount') })); return;
  }
  if (commandName === 'key') {
    if (!argument || rest.length) throw new Error('Use minecraft control key <key-name-or-code>.');
    const key = /^\d+$/.test(argument) ? integer(argument, 'key') : argument;
    output(await sendCommand(root, 'key', { key, action: values.action ?? 'press' })); return;
  }
  if (commandName === 'type') {
    if (argument === undefined) throw new Error('Use minecraft control type <text>.');
    output(await sendCommand(root, 'type', { text: [argument, ...rest].join(' ') })); return;
  }
  if (commandName === 'execute') {
    if (argument === undefined) throw new Error('Use minecraft control execute <command>.');
    output(await sendCommand(root, 'execute', { command: [argument, ...rest].join(' ') })); return;
  }
  if (commandName === 'logs') {
    if (rest.length > 1) throw new Error('Use minecraft control logs [query] [--limit 100].');
    output(await sendCommand(root, 'logs', { queries: argument ? [argument] : [], limit: values.limit === undefined ? 100 : integer(values.limit, 'limit') })); return;
  }
}

main().catch(error => {
  const json = process.argv.includes('--json');
  console.error(json ? JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) : `Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
