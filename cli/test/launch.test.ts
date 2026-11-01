import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { command, controlReady, launch, requireFreePort } from '../dist/launch.js';

async function fixture(): Promise<{ url: string; requests: Array<{ method: string; body: unknown }>; server: Server }> {
  const requests: Array<{ method: string; body: unknown }> = [];
  const server = createServer(async (request, output) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) as unknown : undefined;
    requests.push({ method: request.method ?? '', body });
    const payload = request.url === '/health' ? { ready: true } : { version: '26.3', screen: 'gameplay' };
    output.writeHead(200, { 'Content-Type': 'application/json' });
    output.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}/control`, requests, server };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

test('controlReady checks the local health endpoint without sending a game command', async (t) => {
  const { url, requests, server } = await fixture();
  t.after(() => closeServer(server));

  await controlReady(url);

  assert.deepEqual(requests, [{ method: 'GET', body: undefined }]);
});

test('command posts a named CLI command and returns JSON results', async (t) => {
  const { url, requests, server } = await fixture();
  t.after(() => closeServer(server));

  const result = await command('click', { x: 12, y: 24, button: 'left' }, url);

  assert.deepEqual(requests, [{ method: 'POST', body: { command: 'click', arguments: { x: 12, y: 24, button: 'left' } } }]);
  assert.deepEqual(result, { version: '26.3', screen: 'gameplay' });
});

test('command reports server errors', async (t) => {
  const server = createServer((_request, output) => {
    output.writeHead(409, { 'Content-Type': 'application/json' });
    output.end(JSON.stringify({ error: 'Not connected to a world' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => closeServer(server));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  await assert.rejects(command('execute', { command: 'say hello' }, `http://127.0.0.1:${address.port}/control`), /Not connected to a world/);
});

test('launch rejects a reserved port before reading the package or acquiring the mutex', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mizius-invalid-port-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    launch(root, path.join(root, 'missing-package'), undefined, 'Agent', () => {}, 18765),
    /Port must be an integer/,
  );
  assert.deepEqual(await readdir(root), []);
});

test('requireFreePort detects an occupied alternate port and accepts it after release', async (t) => {
  const socket = createTcpServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise<void>(resolve => socket.close(() => resolve())));
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');

  await assert.rejects(requireFreePort(address.port), new RegExp(`Control port ${address.port} is occupied`));
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  await requireFreePort(address.port);
});
