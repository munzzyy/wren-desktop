// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcRenderer } from 'electron';

import { ACTIVITY_PING_INTERVAL, LockIpc } from './types.std.ts';

// before-input-event in the main process only sees the keyboard, so the
// pointer reaches the auto-lock clock through here, at most once per interval.
let lastPing = 0;

function ping(): void {
  const now = Date.now();
  if (now - lastPing < ACTIVITY_PING_INTERVAL) {
    return;
  }
  lastPing = now;
  ipcRenderer.send(LockIpc.activity);
}

for (const type of ['pointerdown', 'pointermove', 'wheel', 'touchstart']) {
  window.addEventListener(type, ping, { capture: true, passive: true });
}
