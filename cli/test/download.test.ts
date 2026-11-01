import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { download } from '../src/download.ts';

async function fixture(handler: Parameters<typeof createServer>[0]): Promise<{ url: string; server: Server }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}/artifact`, server };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

test('download verifies new and cached files before reusing the cache', async (t) => {
  const bytes = Buffer.from('verified runtime artifact');
  let requests = 0;
  const { url, server } = await fixture((_request, response) => {
    requests++;
    response.writeHead(200, { 'Content-Length': bytes.length });
    response.end(bytes);
  });
  t.after(() => closeServer(server));

  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'cache', 'runtime.zip');
  const source = {
    url,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  };

  await download(file, source);
  await download(file, source);
  assert.equal(requests, 1);
  assert.deepEqual(await readFile(file), bytes);

  await writeFile(file, Buffer.from('corrupt cache entry'));
  await download(file, source);
  assert.equal(requests, 2);
  assert.deepEqual(await readFile(file), bytes);
});

test('download removes interrupted partial files and does not publish them', async (t) => {
  let requests = 0;
  const { url, server } = await fixture((_request, response) => {
    requests++;
    response.writeHead(200, { 'Content-Length': 100, Connection: 'close' });
    response.write('partial response');
    response.socket?.destroy();
  });
  t.after(() => closeServer(server));

  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'cache', 'runtime.zip');

  await assert.rejects(download(file, {
    url,
    sha256: createHash('sha256').update('complete response').digest('hex'),
    size: 17,
  }), /Could not download/);
  assert.equal(requests, 3);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  assert.deepEqual(await readdir(path.dirname(file)), []);
});

test('download removes checksum failures and leaves the cache empty', async (t) => {
  let requests = 0;
  const { url, server } = await fixture((_request, response) => {
    requests++;
    response.end('evil');
  });
  t.after(() => closeServer(server));

  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'cache', 'runtime.zip');

  await assert.rejects(download(file, {
    url,
    sha256: createHash('sha256').update('good').digest('hex'),
    size: 4,
  }), /Could not download/);
  assert.equal(requests, 3);
  assert.deepEqual(await readdir(path.dirname(file)), []);
});
