import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireLock, identity, matchesProcess, stopClient } from '../dist/process.js';
import type { Identity, RunningClient } from '../src/process.ts';

const expected: Identity = {
  pid: 1234,
  started: '2026-11-01T10:00:00.000Z',
  executable: 'C:\\Program Files\\Java\\bin\\java.exe',
  commandLine: 'java -jar "C:\\mizius\\instance\\fabric-server-launch.jar" --gameDir "C:\\Users\\Jan Kramer\\AppData\\Local\\mizius\\Minecraft\\instances\\26.3"',
};

test('matchesProcess requires matching process identity and instance command line', () => {
  const instance = 'C:\\Users\\Jan Kramer\\AppData\\Local\\mizius\\Minecraft\\instances\\26.3';
  assert.equal(matchesProcess({ ...expected, executable: expected.executable.toLowerCase() }, expected, instance), true);
  assert.equal(matchesProcess(null, expected, instance), false);
  assert.equal(matchesProcess({ ...expected, pid: 1235 }, expected, instance), false);
  assert.equal(matchesProcess({ ...expected, started: '2026-11-01T10:00:01.000Z' }, expected, instance), false);
  assert.equal(matchesProcess({ ...expected, executable: 'C:\\Other\\java.exe' }, expected, instance), false);
  assert.equal(matchesProcess({ ...expected, commandLine: `${expected.commandLine} --new-arg` }, expected, instance), false);
  assert.equal(matchesProcess(expected, expected, `${instance}-backup`), false);
  assert.equal(matchesProcess(expected, expected, 'C:\\Users\\Jan Kramer\\AppData\\Local\\mizius\\Minecraft\\instances\\26'), false);
});

test('acquireLock serializes operations and releases the mutex', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const release = await acquireLock(path.join(root, 'first-root'));
  await assert.rejects(acquireLock(path.join(root, 'second-root')), /Another CLI operation is running/);

  await release();
  const releaseAgain = await acquireLock(path.join(root, 'second-root'));
  await releaseAgain();
});

test('the operating system releases the mutex after its owner process exits', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const childRoot = path.join(root, 'child-root');
  const parentRoot = path.join(root, 'parent-root');
  const moduleUrl = new URL('../dist/process.js', import.meta.url).href;
  const script = `import { acquireLock } from ${JSON.stringify(moduleUrl)}; await acquireLock(${JSON.stringify(childRoot)}); process.stdout.write('locked\\n'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  let errorOutput = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errorOutput += chunk; });

  const marker = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', () => {
      if (output.includes('locked')) resolve();
    });
    child.once('error', reject);
    child.once('close', code => {
      if (!output.includes('locked')) reject(new Error(errorOutput || `Child exited with code ${code} before acquiring the mutex.`));
    });
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM') resolve();
      else reject(new Error(errorOutput || `Child exited with code ${code}, signal ${signal}.`));
    });
  });

  try {
    await marker;
    await assert.rejects(acquireLock(parentRoot), /Another CLI operation is running/);
    child.kill();
    await exited;
    const release = await acquireLock(parentRoot);
    await release();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});

test('stopClient checks the start time and handles long process command lines', async (t) => {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    t.skip('Managed process inspection is available only on Windows x64.');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-stop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const instance = path.join(root, 'managed instance');
  const child = spawn(process.execPath, [
    '-e', 'setInterval(() => {}, 1000)', '--', '--gameDir', instance, `--padding=${'x'.repeat(24_000)}`,
  ], { stdio: 'ignore', windowsHide: true });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  assert.ok(child.pid);

  const processIdentity = await identity(child.pid);
  assert.ok(processIdentity);
  assert.ok(processIdentity.commandLine.length > 20_000);
  const record: RunningClient = {
    identity: processIdentity,
    instance,
    version: '26.3',
    log: path.join(root, 'launcher.log'),
    url: 'http://127.0.0.1:8765/mcp',
  };

  await stopClient({
    ...record,
    identity: { ...processIdentity, started: '2000-01-01T00:00:00.0000000Z' },
  });
  assert.ok(await identity(child.pid), 'a reused PID with a different start time must remain alive');

  const exited = once(child, 'exit');
  await stopClient(record);
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('stopClient did not terminate the verified test process')), 10_000);
        timeout.unref();
      }),
    ]);
  } finally { if (timeout) clearTimeout(timeout); }
});
