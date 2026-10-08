// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  ProxyErrorType,
  ProxySettingsType,
  ProxySourceType,
} from './proxyConfig.std.ts';

export type ProxyStatusType = Readonly<{
  saved: ProxySettingsType;
  savedUnreadable: boolean;
  activeSource: ProxySourceType;
  activeOnlyThroughProxy: boolean;
  envOverride: boolean;
  flagOverride: boolean;
  needsRelaunch: boolean;
}>;

export type ProxySaveResultType = Readonly<
  { ok: true; status: ProxyStatusType } | { ok: false; error: ProxyErrorType }
>;

export type ProxyTestResultType = Readonly<
  | { result: 'reachable'; status: number; ms: number }
  | { result: 'proxy-unreachable' }
  | { result: 'server-unreachable' }
  | { result: 'timeout' }
  | { result: 'invalid'; error: ProxyErrorType }
  | { result: 'off' }
>;

export type ProxyProbeResultType = Readonly<{
  active: boolean;
  reachable: boolean;
}>;

export type ProxySettingsApiType = Readonly<{
  getStatus: () => Promise<ProxyStatusType>;
  save: (settings: ProxySettingsType) => Promise<ProxySaveResultType>;
  test: (settings: ProxySettingsType) => Promise<ProxyTestResultType>;
  relaunch: () => void;
}>;

export const ProxyIpc = {
  getStatus: 'wren-proxy:get-status',
  save: 'wren-proxy:save',
  test: 'wren-proxy:test',
  probe: 'wren-proxy:probe',
  check: 'wren-proxy:check',
} as const;
