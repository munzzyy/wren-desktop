// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import net from 'node:net';
import https from 'node:https';
import { TLSSocket, rootCertificates } from 'node:tls';

import { createProxyAgent } from '../../util/createProxyAgent.node.ts';
import { getProxyEndpoint } from './proxyConfig.std.ts';
import type { ProxyTestResultType } from './types.std.ts';

const PROBE_TIMEOUT_MS = 5000;
// Tor can take a while to build a fresh circuit.
const TEST_TIMEOUT_MS = 30000;

export function probeProxy(
  proxyUrl: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<boolean> {
  const endpoint = getProxyEndpoint(proxyUrl);
  if (!endpoint) {
    return Promise.resolve(false);
  }
  return new Promise(resolve => {
    const socket = net.connect({ host: endpoint.host, port: endpoint.port });
    const finish = (reachable: boolean) => {
      socket.removeAllListeners();
      socket.on('error', () => undefined);
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export type TestThroughProxyOptionsType = Readonly<{
  proxyUrl: string;
  serverUrl: string;
  certificateAuthority: string;
  timeoutMs?: number;
  now?: () => number;
}>;

// An HTTP proxy that refuses CONNECT has its error page replayed as the
// response, so only a verified TLS session with the server counts.
export async function testThroughProxy({
  proxyUrl,
  serverUrl,
  certificateAuthority,
  timeoutMs = TEST_TIMEOUT_MS,
  now = Date.now,
}: TestThroughProxyOptionsType): Promise<ProxyTestResultType> {
  if (!(await probeProxy(proxyUrl, Math.min(timeoutMs, PROBE_TIMEOUT_MS)))) {
    return { result: 'proxy-unreachable' };
  }

  let agent: Awaited<ReturnType<typeof createProxyAgent>>;
  try {
    agent = await createProxyAgent(proxyUrl);
  } catch {
    return { result: 'proxy-unreachable' };
  }

  const start = now();
  return new Promise(resolve => {
    let settled = false;
    const settle = (result: ProxyTestResultType) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const request = https.request(
      new URL('/', serverUrl),
      {
        method: 'GET',
        agent,
        ca: [...rootCertificates, certificateAuthority],
        timeout: timeoutMs,
        headers: { 'User-Agent': 'Wren' },
      },
      response => {
        response.resume();
        const { socket } = response;
        const verified = socket instanceof TLSSocket && socket.authorized;
        settle(
          verified
            ? {
                result: 'reachable',
                status: response.statusCode ?? 0,
                ms: now() - start,
              }
            : { result: 'server-unreachable' }
        );
        request.destroy();
      }
    );
    request.once('timeout', () => {
      settle({ result: 'timeout' });
      request.destroy();
    });
    request.once('error', () => settle({ result: 'server-unreachable' }));
    request.end();
  });
}
