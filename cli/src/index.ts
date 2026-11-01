#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { copyFile, mkdir, access } from 'node:fs/promises';
import { readManifest } from './core.js';
import { launch, mcpReady, stop } from './launch.js';
import { running } from './process.js';
import type { RunningClient } from './process.js';

function describe(record: RunningClient) {
  return { pid: record.identity.pid, version: record.version, instance: record.instance, log: record.log, url: record.url };
}

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const help = `Minecraft for agents

  minecraft versions [--json]
  minecraft launch [version] [--username Agent] [--port 8765] [--foreground] [--json]
  minecraft status [--json]
  minecraft stop [--json]
  minecraft skill path
  minecraft skill install --dir <skills-directory>

Windows x64. Instances are stored in %LOCALAPPDATA%\\mizius\\Minecraft.
Set mizius_minecraft_home to use a different managed directory.
Offline profiles cannot join servers requiring account authentication.
`;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, strict: true, options: {
    json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    username: { type: 'string' }, dir: { type: 'string' }, port: { type: 'string' }, foreground: { type: 'boolean' },
  } });
  if (values.help || positionals.length === 0) { console.log(help); return; }
  const [command, argument] = positionals;
  const output = (value: unknown) => console.log(JSON.stringify(value, null, values.json ? undefined : 2));
  if (command === 'skill') {
    if (positionals.length !== 2) throw new Error('Use minecraft skill path or minecraft skill install --dir <skills-directory>.');
    const source = path.join(packageRoot, 'skills', 'minecraft', 'SKILL.md');
    if (argument === 'path') { console.log(path.dirname(source)); return; }
    if (argument !== 'install' || !values.dir) throw new Error('Use minecraft skill install --dir <skills-directory>.');
    const directory = path.resolve(values.dir, 'minecraft');
    await mkdir(directory, { recursive: true });
    await copyFile(source, path.join(directory, 'SKILL.md'), 1);
    output({ installed: directory }); return;
  }
  if (positionals.length > (command === 'launch' ? 2 : 1)) throw new Error('Unexpected positional arguments.');
  if (command === 'versions') {
    const manifest = await readManifest(packageRoot);
    output({ defaultVersion: manifest.defaultVersion, versions: Object.keys(manifest.versions) }); return;
  }
  if (!['launch', 'status', 'stop'].includes(command!)) throw new Error(`Unknown command ${command}. Use minecraft --help.`);
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Managed Minecraft currently requires Windows x64.');
  const base = process.env.mizius_minecraft_home ?? (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'mizius', 'Minecraft'));
  if (!base) throw new Error('LOCALAPPDATA is unavailable. Set mizius_minecraft_home to a managed directory.');
  const root = path.resolve(base);
  if (command === 'launch') {
    output(describe(await launch(root, packageRoot, argument, values.username ?? 'Agent', message => console.error(message), values.port === undefined ? 8765 : Number(values.port), !values.foreground))); return;
  }
  if (command === 'stop') { output(await stop(root)); return; }
  // Do not create any directories when querying status.
  try { await access(root); } catch { output({ running: false, ready: false }); return; }
  const record = await running(root);
  let ready = false;
  if (record) { try { await mcpReady(record.url); ready = true; } catch { /* Process may still be starting. */ } }
  output({ running: !!record, ready, ...(record ? describe(record) : {}) });
}

main().catch(error => {
  const json = process.argv.includes('--json');
  console.error(json ? JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) : `Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
