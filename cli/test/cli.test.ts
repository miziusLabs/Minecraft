import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));

async function run(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('CLI prints help and lists bundled versions as JSON without launching a client', async () => {
  const help = await run('--help');
  assert.match(help.stdout, /minecraft launch \[version\]/);
  assert.match(help.stdout, /minecraft skill install/);

  const result = await run('versions', '--json');
  assert.deepEqual(JSON.parse(result.stdout), {
    defaultVersion: '26.3',
    versions: ['26.2', '26.3'],
  });
});

test('CLI skill install copies the packaged skill without overwriting an existing one', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = fileURLToPath(new URL('../skills/minecraft/SKILL.md', import.meta.url));
  const source = await readFile(sourcePath, 'utf8');

  const result = await run('skill', 'install', '--dir', root, '--json');
  assert.deepEqual(JSON.parse(result.stdout), { installed: path.join(root, 'minecraft') });
  const installed = path.join(root, 'minecraft', 'SKILL.md');
  assert.equal(await readFile(installed, 'utf8'), source);
  await assert.rejects(run('skill', 'install', '--dir', root), /already exists|EEXIST/i);
  assert.equal(await readFile(installed, 'utf8'), source);

  const pathResult = await run('skill', 'path');
  assert.equal(path.basename(pathResult.stdout.trim()), 'minecraft');
  await access(path.join(pathResult.stdout.trim(), 'SKILL.md'));
});

test('CLI rejects the reserved mutex port before creating a managed root', async (t) => {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    t.skip('Managed launch is available only on Windows x64.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [cli, 'launch', '--port', '18765', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, mizius_minecraft_home: root },
    }),
    error => {
      assert.match(String((error as { stderr?: string }).stderr), /Port must be an integer/);
      return true;
    },
  );
  assert.deepEqual(await readdir(root), []);
});
