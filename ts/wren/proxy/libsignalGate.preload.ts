// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { createLogger } from '../../logging/log.std.ts';
import type { GatedNetType } from './libsignalGate.std.ts';
import { runProxyGate } from './libsignalGate.std.ts';
import { checkActiveProxy, probeActiveProxy } from './settingsIpc.preload.ts';

const log = createLogger('wren-proxy-gate');

type ListenerType = (open: boolean) => void;

let gateOpen: boolean | undefined;
const listeners = new Set<ListenerType>();

export function isProxyGateActive(): boolean {
  return gateOpen !== undefined;
}

export function isProxyGateOpen(): boolean {
  return gateOpen === true;
}

export function onProxyGateChange(listener: ListenerType): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startLibsignalProxyGate(
  net: GatedNetType,
  proxyUrl: string
): void {
  runProxyGate({
    net,
    proxyUrl,
    check: checkActiveProxy,
    probe: async () => (await probeActiveProxy()).reachable,
    schedule: (fn, ms) => {
      setTimeout(fn, ms);
    },
    onChange: open => {
      if (gateOpen === open) {
        return;
      }
      gateOpen = open;
      log.info(
        open ? 'proxy reaches Signal, connecting' : 'proxy down, blocked'
      );
      for (const listener of listeners) {
        listener(open);
      }
    },
  });
}
