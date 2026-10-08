// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import type { EffectiveProxyType } from './proxyConfig.std.ts';
import { upgradeLocalDnsScheme } from './proxyConfig.std.ts';

let active: EffectiveProxyType | undefined;

export function setActiveProxy(effective: EffectiveProxyType): void {
  active = effective;
}

export function getActiveProxyUrl(): string | undefined {
  if (active) {
    return active.proxyUrl;
  }
  const env = process.env.HTTPS_PROXY || process.env.https_proxy;
  return env ? upgradeLocalDnsScheme(env) : undefined;
}
