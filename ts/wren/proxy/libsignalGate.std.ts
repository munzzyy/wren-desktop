// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { drop } from '../../util/drop.std.ts';
import { SECOND } from '../../util/durations/index.std.ts';

export const BLOCKED_RETRY = 5 * SECOND;
export const OPEN_RECHECK = 3 * SECOND;

export type GatedNetType = Readonly<{
  setProxyFromUrl: (url: string) => void;
  setInvalidProxy: () => void;
}>;

export type ProxyGateOptionsType = Readonly<{
  net: GatedNetType;
  proxyUrl: string;
  check: () => Promise<boolean>;
  probe: () => Promise<boolean>;
  schedule: (fn: () => void, ms: number) => void;
  onChange: (open: boolean) => void;
}>;

// libsignal falls back to direct when a SOCKS or HTTP proxy fails, so it sits
// on an invalid proxy until a request through the real one has reached Signal.
export function runProxyGate({
  net,
  proxyUrl,
  check,
  probe,
  schedule,
  onChange,
}: ProxyGateOptionsType): void {
  let open = false;
  net.setInvalidProxy();
  onChange(false);

  const close = () => {
    net.setInvalidProxy();
    if (open) {
      open = false;
      onChange(false);
    }
  };

  const tick = async (): Promise<void> => {
    try {
      if (open) {
        if (!(await probe())) {
          close();
        }
      } else if (await check()) {
        net.setProxyFromUrl(proxyUrl);
        open = true;
        onChange(true);
      }
    } catch {
      close();
    }
    schedule(() => drop(tick()), open ? OPEN_RECHECK : BLOCKED_RETRY);
  };

  drop(tick());
}
