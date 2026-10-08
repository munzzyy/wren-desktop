// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import type { DirectFeatureType } from './proxyConfig.std.ts';
import { isDirectFeatureAllowed } from './proxyConfig.std.ts';

export function isDirectFeatureAllowedHere(
  feature: DirectFeatureType
): boolean {
  const config = window.SignalContext?.config;
  if (!config) {
    return true;
  }
  return isDirectFeatureAllowed(
    { proxyUrl: config.proxyUrl, onlyThroughProxy: config.wrenProxyOnly },
    feature
  );
}

export class BlockedByProxyError extends Error {
  constructor(feature: DirectFeatureType) {
    super(`${feature} is off while Wren only connects through the proxy`);
    this.name = 'BlockedByProxyError';
  }
}
