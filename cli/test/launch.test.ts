import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { launch, mcpReady, requireFreePort } from '../dist/launch.js';

async function fixture(response: (request: Record<string, unknown>) => { status?: number; body: unknown }): Promise<{ url: string; requests: Record<string, unknown>[]; server: Server }> {
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, output) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as Record<string, unknown>;
    requests.push(body);
    const result = response(body);
    output.writeHead(result.status ?? 200, { 'Content-Type': 'application/json' });
    output.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}/mcp`, requests, server };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

test('mcpReady initializes the endpoint and confirms the get_state tool call', async (t) => {
  const { url, requests, server } = await fixture(() => ({ body: { jsonrpc: '2.0', id: 1, result: {} } }));
  t.after(() => closeServer(server));

  await mcpReady(url);

  assert.deepEqual(requests.map(request => request.method), ['initialize', 'tools/call']);
  assert.deepEqual(requests[1]?.params, { name: 'get_state', arguments: {} });
});

test('mcpReady rejects HTTP errors, JSON-RPC errors, and tool errors', async (t) => {
  const scenarios = [
    {
      name: 'HTTP errors',
      response: () => ({ status: 503, body: {} }),
      message: /MCP returned HTTP 503/,
    },
    {
      name: 'JSON-RPC errors',
      response: () => ({ body: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'missing' } } }),
      message: /MCP call failed for initialize/,
    },
    {
      name: 'tool errors',
      response: (request: Record<string, unknown>) => ({
        body: { jsonrpc: '2.0', id: 1, result: request.method === 'tools/call' ? { isError: true } : {} },
      }),
      message: /MCP call failed for tools\/call/,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const { url, server } = await fixture(scenario.response);
      subtest.after(() => closeServer(server));
      await assert.rejects(mcpReady(url), scenario.message);
    });
  }
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

  await assert.rejects(requireFreePort(address.port), new RegExp(`Port ${address.port} is occupied`));
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  await requireFreePort(address.port);
});
