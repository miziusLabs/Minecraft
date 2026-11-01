import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  defaultOptions,
  initializeOptions,
  offlineUuid,
  readManifest,
  resolveVersion,
} from '../src/core.ts';

test('offlineUuid follows the vanilla offline player UUID algorithm', () => {
  assert.equal(offlineUuid('Steve'), '5627dd98-e6be-3c21-b8a8-e92344183641');
  assert.notEqual(offlineUuid('Steve'), offlineUuid('steve'));
  assert.throws(() => offlineUuid(''), /3 to 16/);
  assert.throws(() => offlineUuid('name with spaces'), /3 to 16/);
  assert.throws(() => offlineUuid('longusername1234567'), /3 to 16/);
});

test('manifest resolution selects the default or requested bundled version', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'compatibility.json'), JSON.stringify({
    defaultVersion: '26.3',
    versions: {
      '26.2': { loader: '0.19.5', java: 25 },
      '26.3': { loader: '0.19.5', java: 25 },
    },
    mod: { file: 'artifacts/minecraft-control.jar', sha256: 'abc123' },
  }));

  const manifest = await readManifest(root);
  assert.deepEqual(resolveVersion(manifest), {
    version: '26.3',
    compatibility: { loader: '0.19.5', java: 25 },
  });
  assert.deepEqual(resolveVersion(manifest, '26.2'), {
    version: '26.2',
    compatibility: { loader: '0.19.5', java: 25 },
  });
  assert.throws(() => resolveVersion(manifest, '../26.3'), /No compatible bundled mod/);
});

test('readManifest rejects packages without required compatibility metadata', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'compatibility.json'), JSON.stringify({ defaultVersion: '26.3', versions: {} }));
  await assert.rejects(readManifest(root), /Incomplete package compatibility manifest/);
});

test('initializeOptions writes defaults once and preserves player edits', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-options-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await initializeOptions(root, '26.3', 4000);
  const initial = await readFile(path.join(root, 'options.txt'), 'utf8');
  assert.equal(initial, defaultOptions('26.3', 4000));
  assert.match(initial, /fullscreen:false\n/);
  assert.match(initial, /version:4000\n/);
  assert.match(initial, /fov:0\.5\n/);
  assert.match(initial, /key_key\.sprint:key\.keyboard\.r\n/);
  assert.match(initial, /maxFps:60\n/);

  const edited = initial.replace('fullscreen:false', 'fullscreen:true');
  await writeFile(path.join(root, 'options.txt'), edited);
  await initializeOptions(root, '26.2', 4001);
  assert.equal(await readFile(path.join(root, 'options.txt'), 'utf8'), edited);
});
