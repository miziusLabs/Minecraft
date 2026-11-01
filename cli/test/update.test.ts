import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { attemptAutomaticUpdate, createNpmAdapter, isNewerVersion, relaunchCli, updateCli } from '../src/update.ts';
import type { NpmAdapter } from '../src/update.ts';

const execFileAsync = promisify(execFile);

async function makePackage(root: string, version: string): Promise<string> {
  const packageDirectory = path.join(root, 'package');
  await mkdir(path.join(packageDirectory, 'dist'), { recursive: true });
  await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({
    name: '@mizius/minecraft',
    version,
    type: 'module',
    bin: { minecraft: 'dist/index.js' },
  }));
  await writeFile(path.join(packageDirectory, 'dist', 'index.js'), `process.stdout.write(${JSON.stringify(version)});\n`);
  const archive = path.join(root, `minecraft-${version}.tgz`);
  await execFileAsync('tar', ['-czf', archive, '-C', root, 'package'], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
  });
  return archive;
}

interface ReleaseServerOptions {
  tarball: string;
  digest?: string;
  version?: string;
}

async function releaseServer(options: ReleaseServerOptions): Promise<{ url: string; server: Server }> {
  const bytes = await readFile(options.tarball);
  const version = options.version ?? '1.0.2';
  const tag = `v${version}`;
  const server = createServer((request, response) => {
    if (request.url === '/repos/miziusLabs/Minecraft/releases/latest') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        tag_name: tag,
        draft: false,
        prerelease: false,
        assets: [{
          name: 'minecraft.tgz',
          state: 'uploaded',
          browser_download_url: `http://${request.headers.host}/miziusLabs/Minecraft/releases/download/${tag}/minecraft.tgz`,
          digest: options.digest ?? `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          size: bytes.length,
        }],
      }));
      return;
    }
    if (request.url === `/miziusLabs/Minecraft/releases/download/${tag}/minecraft.tgz`) {
      response.writeHead(200, { 'Content-Length': bytes.length });
      response.end(bytes);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}/repos/miziusLabs/Minecraft/releases/latest`, server };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

async function installedPackage(prefix: string, version: string): Promise<{ root: string; npm: NpmAdapter }> {
  const npm = createNpmAdapter(prefix);
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'mizius-update-base-'));
  try {
    await npm.install(await makePackage(archiveRoot, version));
  } finally {
    await rm(archiveRoot, { recursive: true, force: true });
  }
  return { root: path.join(await npm.globalRoot(), '@mizius', 'minecraft'), npm };
}

test('version comparison accepts only a newer stable semantic version', () => {
  assert.equal(isNewerVersion('1.0.2', '1.0.1'), true);
  assert.equal(isNewerVersion('1.1.0', '1.0.99'), true);
  assert.equal(isNewerVersion('2.0.0', '1.99.99'), true);
  assert.equal(isNewerVersion('1.0.1', '1.0.1'), false);
  assert.equal(isNewerVersion('1.0.0', '1.0.1'), false);
  assert.equal(isNewerVersion('1.0.2-beta.1', '1.0.1'), false);
  assert.equal(isNewerVersion('01.0.2', '1.0.1'), false);
});

test('updateCli verifies and installs the latest release into an isolated npm prefix', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prefix = path.join(root, 'prefix');
  const current = await installedPackage(prefix, '1.0.1');
  const releaseRoot = path.join(root, 'release');
  await mkdir(releaseRoot);
  const archive = await makePackage(releaseRoot, '1.0.2');
  const fixture = await releaseServer({ tarball: archive });
  t.after(() => closeServer(fixture.server));

  const result = await updateCli(current.root, {
    releaseApiUrl: fixture.url,
    npmAdapter: current.npm,
    temporaryRoot: root,
  });

  assert.deepEqual(result, { previousVersion: '1.0.1', installedVersion: '1.0.2', updated: true });
  assert.deepEqual(JSON.parse(await readFile(path.join(current.root, 'package.json'), 'utf8')), {
    name: '@mizius/minecraft', version: '1.0.2', type: 'module', bin: { minecraft: 'dist/index.js' },
  });
});

test('updateCli rejects a bad asset digest without changing the installed package', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prefix = path.join(root, 'prefix');
  const current = await installedPackage(prefix, '1.0.1');
  const releaseRoot = path.join(root, 'release');
  await mkdir(releaseRoot);
  const archive = await makePackage(releaseRoot, '1.0.2');
  const fixture = await releaseServer({ tarball: archive, digest: `sha256:${'0'.repeat(64)}` });
  t.after(() => closeServer(fixture.server));

  const attempt = await attemptAutomaticUpdate(current.root, {
    releaseApiUrl: fixture.url,
    npmAdapter: current.npm,
    temporaryRoot: root,
  });
  assert.match(attempt.error?.message ?? '', /size or SHA-256 digest did not match/);
  assert.equal(attempt.result, undefined);
  assert.equal(attempt.fatal, false);
  assert.equal(JSON.parse(await readFile(path.join(current.root, 'package.json'), 'utf8')).version, '1.0.1');
});

test('updateCli restores the previous package when npm fails after replacing it', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prefix = path.join(root, 'prefix');
  const current = await installedPackage(prefix, '1.0.1');
  const releaseRoot = path.join(root, 'release');
  await mkdir(releaseRoot);
  const archive = await makePackage(releaseRoot, '1.0.2');
  const fixture = await releaseServer({ tarball: archive });
  t.after(() => closeServer(fixture.server));
  const failingNpm: NpmAdapter = {
    globalRoot: current.npm.globalRoot,
    async install() {
      await rm(current.root, { recursive: true, force: true });
      throw new Error('fixture npm failure');
    },
  };

  await assert.rejects(updateCli(current.root, {
    releaseApiUrl: fixture.url,
    npmAdapter: failingNpm,
    temporaryRoot: root,
  }), /previous CLI version was restored/);
  assert.equal(JSON.parse(await readFile(path.join(current.root, 'package.json'), 'utf8')).version, '1.0.1');
});

test('relaunchCli preserves the requested command arguments and returns its exit code', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-relaunch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'arguments.json');
  const entrypoint = path.join(root, 'updated-cli.mjs');
  await writeFile(entrypoint, [
    "import { writeFile } from 'node:fs/promises';",
    `await writeFile(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2)));`,
    'process.exitCode = 7;',
  ].join('\n'));
  const args = ['launch', '26.2', '--username', 'Agent', '--port', '18766', '--foreground', '--json'];

  assert.equal(await relaunchCli(entrypoint, [], args), 7);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), args);
});
