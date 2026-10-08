// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import net from 'node:net';
import type { AddressInfo } from 'node:net';
import tls from 'node:tls';
import { assert } from 'chai';

import {
  probeProxy,
  testThroughProxy,
} from '../../../wren/proxy/proxyCheck.node.ts';

// Self-signed, test only, for a name under .invalid that cannot exist.
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBszCCAVmgAwIBAgIUatREFIaUUEKJoozxcCxL2mV6OAQwCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTY2hhdC5zaWduYWwuaW52YWxpZDAgFw0yNjEwMDgxNzA4Mzha
GA8yMTI2MDkxNDE3MDgzOFowHjEcMBoGA1UEAwwTY2hhdC5zaWduYWwuaW52YWxp
ZDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABGJOshDS5pLJJxFH3URTjoYMUHMn
QZT9qun85RvtFy7aQidCzsmcPxdbEuBwVMYyzV46ygABFUIaeWtuJ3BVFRWjczBx
MB0GA1UdDgQWBBQ5h8+SbFZ3GR1nzXwVrB2hFHI+MDAfBgNVHSMEGDAWgBQ5h8+S
bFZ3GR1nzXwVrB2hFHI+MDAPBgNVHRMBAf8EBTADAQH/MB4GA1UdEQQXMBWCE2No
YXQuc2lnbmFsLmludmFsaWQwCgYIKoZIzj0EAwIDSAAwRQIgVZMyqViQJM36XskN
MyCKTEGI2NWf2WDwW7f9rPzIpCgCIQCmNaXorXwYgMKvwBZqpOgLniHN6NGa8+vh
npeXE2q5oA==
-----END CERTIFICATE-----`;
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgvLBsqD9FeuDmnjfa
Bn32vJDOg/4+wg3HR2NmRZqQi+ShRANCAARiTrIQ0uaSyScRR91EU46GDFBzJ0GU
/arp/OUb7Rcu2kInQs7JnD8XWxLgcFTGMs1eOsoAARVCGnlrbidwVRUV
-----END PRIVATE KEY-----`;

type SocksRequestType = Readonly<{
  methods: ReadonlyArray<number>;
  username?: string;
  addressType?: number;
  address?: string;
  port?: number;
}>;

// Speaks just enough SOCKS5 to record what the client asked for. It either
// refuses the connection or pipes it to a local port, so nothing leaves the
// machine.
async function startFakeSocks(forwardTo?: number): Promise<{
  port: number;
  requests: Array<SocksRequestType>;
  close: () => Promise<void>;
}> {
  const requests: Array<SocksRequestType> = [];
  const server = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    let stage: 'greeting' | 'auth' | 'request' | 'done' = 'greeting';
    let current: {
      -readonly [K in keyof SocksRequestType]: SocksRequestType[K];
    } = { methods: [] };
    socket.on('error', () => undefined);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting' && buffer.length >= 2) {
        const count = buffer[1] ?? 0;
        if (buffer.length < 2 + count) {
          return;
        }
        current.methods = [...buffer.subarray(2, 2 + count)];
        buffer = buffer.subarray(2 + count);
        const wantsAuth = current.methods.includes(2);
        socket.write(Buffer.from([5, wantsAuth ? 2 : 0]));
        stage = wantsAuth ? 'auth' : 'request';
      }
      if (stage === 'auth' && buffer.length >= 2) {
        const userLength = buffer[1] ?? 0;
        const passLength = buffer[2 + userLength];
        if (
          passLength === undefined ||
          buffer.length < 3 + userLength + passLength
        ) {
          return;
        }
        current.username = buffer.subarray(2, 2 + userLength).toString();
        buffer = buffer.subarray(3 + userLength + passLength);
        socket.write(Buffer.from([1, 0]));
        stage = 'request';
      }
      if (stage === 'request' && buffer.length >= 5) {
        const addressType = buffer[3];
        let end: number;
        if (addressType === 3) {
          end = 5 + (buffer[4] ?? 0);
          current.address = buffer.subarray(5, end).toString();
        } else if (addressType === 1) {
          end = 8;
          current.address = [...buffer.subarray(4, 8)].join('.');
        } else {
          end = 20;
          current.address = buffer.subarray(4, 20).toString('hex');
        }
        if (buffer.length < end + 2) {
          return;
        }
        current.addressType = addressType;
        current.port = buffer.readUInt16BE(end);
        requests.push(current);
        current = { methods: [] };
        stage = 'done';
        if (forwardTo === undefined) {
          // 0x05: connection refused
          socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
          return;
        }
        const upstream = net.connect(forwardTo, '127.0.0.1', () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          socket.pipe(upstream).pipe(socket);
        });
        upstream.on('error', () => socket.destroy());
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    requests,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

describe('wren/proxy/proxyCheck', () => {
  it('reports a closed proxy port as unreachable', async () => {
    const port = await closedPort();
    assert.isFalse(await probeProxy(`socks5h://127.0.0.1:${port}`, 2000));
    assert.deepEqual(
      await testThroughProxy({
        proxyUrl: `socks5h://127.0.0.1:${port}`,
        serverUrl: 'https://chat.signal.invalid',
        certificateAuthority: '',
        timeoutMs: 2000,
      }),
      { result: 'proxy-unreachable' }
    );
  });

  it('hands the server name to the proxy instead of resolving it', async () => {
    const socks = await startFakeSocks();
    try {
      assert.isTrue(await probeProxy(`socks5h://127.0.0.1:${socks.port}`));
      const outcome = await testThroughProxy({
        proxyUrl: `socks5h://wren:isolation@127.0.0.1:${socks.port}`,
        // .invalid never resolves, so a local lookup would fail before the
        // proxy saw anything.
        serverUrl: 'https://chat.signal.invalid',
        certificateAuthority: '',
        timeoutMs: 5000,
      });
      assert.deepEqual(outcome, { result: 'server-unreachable' });
      assert.lengthOf(socks.requests, 1);
      const [request] = socks.requests;
      assert.include(request?.methods ?? [], 2);
      assert.strictEqual(request?.username, 'wren');
      assert.strictEqual(request?.addressType, 3);
      assert.strictEqual(request?.address, 'chat.signal.invalid');
      assert.strictEqual(request?.port, 443);
    } finally {
      await socks.close();
    }
  });

  it('calls it reachable only after verified TLS with the server', async () => {
    const server = tls.createServer({ cert: TEST_CERT, key: TEST_KEY }, s => {
      s.on('error', () => undefined);
      s.once('data', () => {
        s.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port: tlsPort } = server.address() as AddressInfo;
    const socks = await startFakeSocks(tlsPort);
    try {
      const outcome = await testThroughProxy({
        proxyUrl: `socks5h://127.0.0.1:${socks.port}`,
        serverUrl: 'https://chat.signal.invalid',
        certificateAuthority: TEST_CERT,
        timeoutMs: 5000,
        now: () => 1000,
      });
      assert.deepEqual(outcome, { result: 'reachable', status: 404, ms: 0 });
      assert.strictEqual(socks.requests[0]?.address, 'chat.signal.invalid');

      // Same path, but the certificate is not trusted: not reachable.
      const untrusted = await testThroughProxy({
        proxyUrl: `socks5h://127.0.0.1:${socks.port}`,
        serverUrl: 'https://chat.signal.invalid',
        certificateAuthority: '',
        timeoutMs: 5000,
      });
      assert.deepEqual(untrusted, { result: 'server-unreachable' });
    } finally {
      await socks.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('sends CONNECT with the server name to an HTTP proxy', async () => {
    const lines: Array<string> = [];
    const server = net.createServer(socket => {
      socket.on('error', () => undefined);
      socket.once('data', chunk => {
        lines.push(chunk.toString().split('\r\n')[0] ?? '');
        socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const outcome = await testThroughProxy({
        proxyUrl: `http://127.0.0.1:${port}`,
        serverUrl: 'https://chat.signal.invalid',
        certificateAuthority: '',
        timeoutMs: 5000,
      });
      assert.deepEqual(outcome, { result: 'server-unreachable' });
      assert.deepEqual(lines, ['CONNECT chat.signal.invalid:443 HTTP/1.1']);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
