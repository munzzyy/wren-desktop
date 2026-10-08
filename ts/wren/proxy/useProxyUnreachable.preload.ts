// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { useSyncExternalStore } from 'react';

import {
  isProxyGateActive,
  isProxyGateOpen,
  onProxyGateChange,
} from './libsignalGate.preload.ts';

function getSnapshot(): boolean {
  return isProxyGateActive() && !isProxyGateOpen();
}

// Without "only through the proxy", a dead proxy does not stop libsignal.
export function useProxyUnreachable(): boolean {
  return useSyncExternalStore(onProxyGateChange, getSnapshot);
}
