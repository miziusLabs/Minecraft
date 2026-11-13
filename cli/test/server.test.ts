import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { launchServer, serverDirectory, serverRequest } from '../dist/server.js';

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'minecraft-server-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('server folders isolate versions and reject paths outside the managed root', () => {
  assert.notEqual(serverDirectory('/managed', '1.21.4'), serverDirectory('/managed', '1.21.5'));
  for (const version of ['../world', '..', '/tmp/server', 'a\\b', '']) assert.throws(() => serverDirectory('/managed', version), /Invalid/);
});

test('new servers require EULA acceptance without changing existing files', async t => {
  const root = await fixture(t);
  await assert.rejects(launchServer(root, { version: '1.21.4' }), /accept-eula/);
  assert.deepEqual(await serverRequest(serverDirectory(root, '1.21.4'), 'status'), { running: false, ready: false });
});

test('server manager retains its process after the launcher disconnects and sends console commands', { skip: process.platform === 'win32' }, async t => {
  const directory = await fixture(t);
  // A console process stands in for Java so this lifecycle test needs no game download.
  const java = path.join(directory, 'java');
  const commands = path.join(directory, 'commands.txt');
  await writeFile(java, `#!/usr/bin/env node
const fs = require('node:fs');
const rl = require('node:readline').createInterface({input: process.stdin});
console.log('Done (0.1s)! For help, type "help"');
rl.on('line', command => { fs.appendFileSync(${JSON.stringify(commands)}, command + '\\n'); if (command === 'stop') process.exit(0); });
`, { mode: 0o755 });
  await writeFile(path.join(directory, 'world-marker'), 'preserve me');
  const child = fork(new URL('../dist/server-worker.js', import.meta.url), [directory, java, '1.21.4'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] });
  const exit = once(child, 'exit');
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const [started] = await once(child, 'message');
  assert.equal(started.running, true);
  child.disconnect();
  const record = JSON.parse(await readFile(path.join(directory, 'server.json'), 'utf8'));
  assert.equal((await fetch(`http://127.0.0.1:${record.port}/stop`, { method: 'POST' })).status, 401);
  assert.equal((await serverRequest(directory, 'command', 'say hello')).sent, true);
  await assert.rejects(serverRequest(directory, 'command', 'say hello\nstop'), /nonempty server console command/);
  assert.equal((await serverRequest(directory, 'status')).running, true);
  assert.deepEqual(await serverRequest(directory, 'stop'), { stopped: true });
  await exit;
  assert.equal(await readFile(commands, 'utf8'), 'say hello\nstop\n');
  assert.equal(await readFile(path.join(directory, 'world-marker'), 'utf8'), 'preserve me');
  assert.equal((await serverRequest(directory, 'status')).running, false);
});
