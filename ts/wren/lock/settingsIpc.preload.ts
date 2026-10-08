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
  clearDuress: () => ipcRenderer.invoke(LockIpc.clearDuress),
  setWipeAfter: value => ipcRenderer.invoke(LockIpc.setWipeAfter, value),
  setAutoLockMinutes: value =>
    ipcRenderer.invoke(LockIpc.setAutoLockMinutes, value),
  setLockOnSystemLock: value =>
    ipcRenderer.invoke(LockIpc.setLockOnSystemLock, value),
  lockNow: () => ipcRenderer.send(LockIpc.lockNow),
};
