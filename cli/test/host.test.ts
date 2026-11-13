import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import test from 'node:test';
import { WebSocket, createWebSocketStream } from 'ws';
import { createHost, remoteCommand, tunnelConnection, validateRemoteArgs } from '../dist/host.js';

const exec = promisify(execFile);

async function fixture(t: test.TestContext, sshPort = 22) {
  const token = randomBytes(32).toString('hex');
  const host = createHost(token, sshPort);
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  t.after(() => host.close());
  const origin = `http://127.0.0.1:${(host.server.address() as AddressInfo).port}`;
  return { origin, token, tunnel: `${origin}/#${token}` };
}

test('tunnel credentials stay out of request URLs and insecure remote URLs are rejected', () => {
  const token = randomBytes(32).toString('hex');
  assert.equal(tunnelConnection(`https://example.com/#${token}`).url.href, 'https://example.com/');
  assert.throws(() => tunnelConnection(`http://example.com/#${token}`), /HTTPS/);
  assert.throws(() => tunnelConnection('https://example.com/'), /complete TUNNEL/);
  assert.throws(() => tunnelConnection(`https://example.com/?token=${token}#${token}`), /complete TUNNEL/);
  assert.throws(() => validateRemoteArgs(['host', 'launch']), /cannot run remotely/);
  assert.throws(() => validateRemoteArgs(['launch', '--foreground']), /background/);
});

test('host rejects unauthorized commands and does not expose host management remotely', async t => {
  const { origin, token } = await fixture(t);
  const request = (args: unknown, credential = token) => fetch(`${origin}/command`, {
    method: 'POST', headers: { Authorization: `Bearer ${credential}` }, body: JSON.stringify(args),
  });
  assert.equal((await request(['versions'], 'wrong')).status, 401);
  assert.equal((await request(['host', 'launch'])).status, 400);
  assert.equal((await request(['versions', 3])).status, 400);
  assert.equal((await fetch(`${origin}/command`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } })).status, 404);
});

test('TUNNEL runs the real CLI on the host and propagates command output and failures', async t => {
  const { tunnel } = await fixture(t);
  const original = process.env.TUNNEL;
  process.env.TUNNEL = 'invalid-inherited-tunnel';
  t.after(() => { if (original === undefined) delete process.env.TUNNEL; else process.env.TUNNEL = original; });
  const env = { ...process.env, TUNNEL: tunnel };
  const result = await exec(process.execPath, ['dist/index.js', 'versions', '--json'], { env });
  assert.ok(JSON.parse(result.stdout).versions.includes('1.21.4'));
  const status = await exec(process.execPath, ['dist/index.js', 'server', 'status', '--version', 'test-missing-version', '--json'], { env });
  assert.equal(JSON.parse(status.stdout).running, false);
  await assert.rejects(exec(process.execPath, ['dist/index.js', 'server', 'status'], { env }), error => {
    assert.match((error as Error & { stderr: string }).stderr, /Specify --version/);
    return true;
  });
});

test('SSH websocket forwards binary data bidirectionally and requires authentication', async t => {
  const tcp = createServer(socket => socket.pipe(socket));
  await new Promise<void>(resolve => tcp.listen(0, '127.0.0.1', resolve));
  const { origin, token } = await fixture(t, (tcp.address() as AddressInfo).port);
  t.after(() => new Promise<void>(resolve => tcp.close(() => resolve())));
  const endpoint = `${origin.replace('http:', 'ws:')}/ssh`;
  const denied = new WebSocket(endpoint);
  await new Promise<void>(resolve => denied.once('error', error => { assert.match(error.message, /401/); resolve(); }));
  const ws = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  t.after(() => ws.terminate());
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const stream = createWebSocketStream(ws);
  const payload = randomBytes(256 * 1024);
  const received: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    let length = 0;
    stream.on('data', (chunk: Buffer) => {
      received.push(chunk); length += chunk.length;
      if (length === payload.length) resolve(Buffer.concat(received));
    });
    stream.on('error', reject);
  });
  stream.write(payload);
  assert.deepEqual(await complete, payload);
});


test('remote screenshots save their exact bytes on the controller', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minecraft-remote-screen-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const token = randomBytes(32).toString('hex');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64');
  const output = path.join(directory, 'controller.png');
  const server = createHttpServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.deepEqual(JSON.parse(body), ['control', 'screenshot', '--output', output]);
    response.end(`${JSON.stringify({ screenshot: png.toString('base64') })}\n${JSON.stringify({ code: 0 })}\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const tunnel = `http://127.0.0.1:${(server.address() as AddressInfo).port}/#${token}`;
  assert.equal(await remoteCommand(tunnel, ['control', 'screenshot', '--output', output]), 0);
  assert.deepEqual(await readFile(output), png);
});
