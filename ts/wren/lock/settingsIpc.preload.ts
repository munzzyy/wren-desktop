// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcRenderer } from 'electron';

import type { LockSettingsApiType } from './types.std.ts';
import { LockIpc } from './types.std.ts';

export const lockSettingsApi: LockSettingsApiType = {
  getStatus: () => ipcRenderer.invoke(LockIpc.getStatus),
  enable: passphrase => ipcRenderer.invoke(LockIpc.enable, passphrase),
  change: (current, next) => ipcRenderer.invoke(LockIpc.change, current, next),
  disable: current => ipcRenderer.invoke(LockIpc.disable, current),
  setDuress: duress => ipcRenderer.invoke(LockIpc.setDuress, duress),
  clearDuress: current => ipcRenderer.invoke(LockIpc.clearDuress, current),
  setWipeAfter: (value, current) =>
    ipcRenderer.invoke(LockIpc.setWipeAfter, value, current),
  setAutoLockMinutes: (value, current) =>
    ipcRenderer.invoke(LockIpc.setAutoLockMinutes, value, current),
  setLockOnSystemLock: (value, current) =>
    ipcRenderer.invoke(LockIpc.setLockOnSystemLock, value, current),
  lockNow: () => ipcRenderer.send(LockIpc.lockNow),
};
