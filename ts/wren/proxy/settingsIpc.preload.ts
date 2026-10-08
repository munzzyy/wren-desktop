// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcRenderer } from 'electron';

import type {
  ProxyProbeResultType,
  ProxySettingsApiType,
} from './types.std.ts';
import { ProxyIpc } from './types.std.ts';

export const proxySettingsApi: ProxySettingsApiType = {
  getStatus: () => ipcRenderer.invoke(ProxyIpc.getStatus),
  save: settings => ipcRenderer.invoke(ProxyIpc.save, settings),
  test: settings => ipcRenderer.invoke(ProxyIpc.test, settings),
  relaunch: () => ipcRenderer.send('restart'),
};

export function probeActiveProxy(): Promise<ProxyProbeResultType> {
  return ipcRenderer.invoke(ProxyIpc.probe);
}

export function checkActiveProxy(): Promise<boolean> {
  return ipcRenderer.invoke(ProxyIpc.check);
}
