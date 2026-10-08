// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { contextBridge, ipcRenderer } from 'electron';

import type { LockWindowApiType } from '../types.std.ts';
import { LockIpc } from '../types.std.ts';

const api: LockWindowApiType = {
  getInfo: () => ipcRenderer.invoke(LockIpc.windowInfo),
  unlock: passphrase => ipcRenderer.invoke(LockIpc.unlock, passphrase),
};

contextBridge.exposeInMainWorld('WrenLockWindow', api);
