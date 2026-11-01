import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractZip, publishRuntime, safePath } from '../dist/install.js';

test('safePath rejects archive paths that escape the installation root', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.throws(() => safePath(root, '../outside.dll'), /Unsafe archive path/);
  assert.throws(() => safePath(root, '..\\outside.dll'), /Unsafe archive path/);
  assert.throws(() => safePath(root, 'C:\\outside.dll'), /Unsafe archive path/);
  assert.throws(() => safePath(root, 'dir/file:stream'), /Unsafe archive path/);
});

test('extractZip refuses traversal entries before writing outside the destination', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archivePath = path.join(root, 'traversal.zip');
  const destination = path.join(root, 'runtime');
  const archive = new AdmZip();
  const entry = archive.addFile('outside.dll', Buffer.from('outside'));
  entry.entryName = '../outside.dll';
  await archive.writeZipPromise(archivePath);

  await assert.rejects(extractZip(archivePath, destination), /Unsafe archive path/);
  await assert.rejects(access(path.join(root, 'outside.dll')), { code: 'ENOENT' });
});

test('extractZip refuses symbolic links and applies native archive exclusions', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const symlinkPath = path.join(root, 'symlink.zip');
  const symlinkZip = new AdmZip();
  const link = symlinkZip.addFile('link', Buffer.from('target.dll'));
  link.attr = (0o120777 << 16) >>> 0;
  await symlinkZip.writeZipPromise(symlinkPath);
  await assert.rejects(extractZip(symlinkPath, path.join(root, 'symlink-runtime')), /symbolic link/);

  const nativePath = path.join(root, 'native.zip');
  const nativeZip = new AdmZip();
  nativeZip.addFile('META-INF/signature.SF', Buffer.from('signature'));
  nativeZip.addFile('org/example/native.dll', Buffer.from('native library'));
  await nativeZip.writeZipPromise(nativePath);
  const destination = path.join(root, 'native-runtime');
  await mkdir(destination, { recursive: true });
  await extractZip(nativePath, destination, ['META-INF/']);

  assert.equal(await readFile(path.join(destination, 'org', 'example', 'native.dll'), 'utf8'), 'native library');
  await assert.rejects(access(path.join(destination, 'META-INF', 'signature.SF')), { code: 'ENOENT' });
});

test('publishRuntime replaces an incomplete runtime directory', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, 'runtime');
  const runtime = path.join(runtimeRoot, 'java-25');
  const temporary = path.join(runtimeRoot, 'java-25.repair.tmp');
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, 'partial.txt'), 'incomplete');
  await mkdir(temporary, { recursive: true });
  await writeFile(path.join(temporary, 'installed.json'), '{"executable":"jdk/bin/javaw.exe"}');
  await writeFile(path.join(temporary, 'repaired.txt'), 'complete');

  await publishRuntime(root, 25, temporary);

  assert.equal(await readFile(path.join(runtime, 'repaired.txt'), 'utf8'), 'complete');
  await assert.rejects(access(path.join(runtime, 'partial.txt')), { code: 'ENOENT' });
  assert.deepEqual(await readdir(runtimeRoot), ['java-25']);
});

test('publishRuntime restores the previous runtime if publication fails', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, 'runtime');
  const runtime = path.join(runtimeRoot, 'java-25');
  const missingTemporary = path.join(runtimeRoot, 'java-25.missing.tmp');
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, 'installed.json'), '{"executable":"java/bin/javaw.exe"}');

  await assert.rejects(publishRuntime(root, 25, missingTemporary), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(runtime, 'installed.json'), 'utf8'), '{"executable":"java/bin/javaw.exe"}');
  assert.deepEqual(await readdir(runtimeRoot), ['java-25']);
});
