// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

export const PROXY_CONFIG_KEY = 'wrenProxy';

export const TOR_HOST = '127.0.0.1';
export const TOR_DEFAULT_PORT = 9050;
export const TOR_BROWSER_PORT = 9150;
export const SOCKS_DEFAULT_PORT = 1080;

// RFC 1929 caps the SOCKS5 username and password at 255 bytes each.
export const MAX_CREDENTIAL_BYTES = 255;
const MAX_HOST_LENGTH = 253;
const MAX_URL_LENGTH = 2048;

// Unreadable settings point every layer at the closed discard port.
export const BLOCKED_PROXY_URL = 'socks5h://127.0.0.1:9';
export const BLOCKED_CHROMIUM_RULES = 'socks5://127.0.0.1:9';

export const PROXY_MODES = ['off', 'socks5', 'tor', 'http'] as const;
export type ProxyModeType = (typeof PROXY_MODES)[number];

export type ProxySettingsType = Readonly<{
  version: 1;
  mode: ProxyModeType;
  host: string;
  port: number;
  torPort: number;
  username: string;
  password: string;
  httpUrl: string;
  onlyThroughProxy: boolean;
}>;

export const DEFAULT_PROXY_SETTINGS: ProxySettingsType = {
  version: 1,
  mode: 'off',
  host: '',
  port: SOCKS_DEFAULT_PORT,
  torPort: TOR_DEFAULT_PORT,
  username: '',
  password: '',
  httpUrl: '',
  onlyThroughProxy: true,
};

export type ProxyErrorType =
  | 'invalid'
  | 'invalid-host'
  | 'invalid-port'
  | 'invalid-credentials'
  | 'invalid-url';

export type ProxyValidationType = Readonly<
  | { ok: true; settings: ProxySettingsType }
  | { ok: false; error: ProxyErrorType }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

export function isProxyMode(value: unknown): value is ProxyModeType {
  return PROXY_MODES.some(mode => mode === value);
}

export function isValidPort(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
}

const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isIPv6(host: string): boolean {
  if (!host.includes(':') || !/^[0-9a-f:.]+$/i.test(host)) {
    return false;
  }
  try {
    return new URL(`http://[${host}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

export function isValidHost(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  if (value.length === 0 || value.length > MAX_HOST_LENGTH) {
    return false;
  }
  if (IPV4.test(value) || isIPv6(value)) {
    return true;
  }
  if (/^[\d.]+$/.test(value)) {
    return false;
  }
  return value.split('.').every(label => HOST_LABEL.test(label));
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function isValidCredential(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    utf8Length(value) <= MAX_CREDENTIAL_BYTES &&
    !CONTROL_CHARS.test(value)
  );
}

export function parseHttpProxyUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) {
    return undefined;
  }
  if (CONTROL_CHARS.test(value) || /\s/.test(value)) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return undefined;
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (!isValidHost(host)) {
    return undefined;
  }
  return url;
}

export function validateProxySettings(input: unknown): ProxyValidationType {
  if (!isRecord(input) || !isProxyMode(input.mode)) {
    return { ok: false, error: 'invalid' };
  }

  const pick = <T>(key: keyof ProxySettingsType, fallback: T): unknown =>
    input[key] === undefined ? fallback : input[key];

  const host = pick('host', DEFAULT_PROXY_SETTINGS.host);
  const port = pick('port', DEFAULT_PROXY_SETTINGS.port);
  const torPort = pick('torPort', DEFAULT_PROXY_SETTINGS.torPort);
  const username = pick('username', '');
  const password = pick('password', '');
  const httpUrl = pick('httpUrl', '');
  const onlyThroughProxy = pick(
    'onlyThroughProxy',
    DEFAULT_PROXY_SETTINGS.onlyThroughProxy
  );

  if (
    typeof host !== 'string' ||
    typeof httpUrl !== 'string' ||
    typeof onlyThroughProxy !== 'boolean'
  ) {
    return { ok: false, error: 'invalid' };
  }
  if (!isValidPort(port) || !isValidPort(torPort)) {
    return { ok: false, error: 'invalid-port' };
  }
  if (!isValidCredential(username) || !isValidCredential(password)) {
    return { ok: false, error: 'invalid-credentials' };
  }

  const { mode } = input;
  const trimmedHost = host.trim();
  const trimmedUrl = httpUrl.trim();

  if (mode === 'socks5') {
    if (!isValidHost(trimmedHost)) {
      return { ok: false, error: 'invalid-host' };
    }
    if (password !== '' && username === '') {
      return { ok: false, error: 'invalid-credentials' };
    }
  }
  if (mode === 'http' && parseHttpProxyUrl(trimmedUrl) === undefined) {
    return { ok: false, error: 'invalid-url' };
  }

  return {
    ok: true,
    settings: {
      version: 1,
      mode,
      host: trimmedHost,
      port,
      torPort,
      username,
      password,
      httpUrl: trimmedUrl,
      onlyThroughProxy,
    },
  };
}

export type StoredProxySettingsType = Readonly<
  | { kind: 'missing' }
  | { kind: 'ok'; settings: ProxySettingsType }
  | { kind: 'unreadable' }
>;

export function parseStoredProxySettings(
  value: unknown
): StoredProxySettingsType {
  if (value == null) {
    return { kind: 'missing' };
  }
  if (!isRecord(value) || value.version !== 1) {
    return { kind: 'unreadable' };
  }
  const result = validateProxySettings(value);
  if (!result.ok) {
    return { kind: 'unreadable' };
  }
  return { kind: 'ok', settings: result.settings };
}

export function serializeProxySettings(
  settings: ProxySettingsType
): ProxySettingsType {
  return {
    version: 1,
    mode: settings.mode,
    host: settings.host,
    port: settings.port,
    torPort: settings.torPort,
    username: settings.username,
    password: settings.password,
    httpUrl: settings.httpUrl,
    onlyThroughProxy: settings.onlyThroughProxy,
  };
}

function hostForUrl(host: string): string {
  return isIPv6(host) ? `[${host}]` : host;
}

function userInfo(username: string, password: string): string {
  if (username === '') {
    return '';
  }
  const user = encodeURIComponent(username);
  return password === ''
    ? `${user}@`
    : `${user}:${encodeURIComponent(password)}@`;
}

export type TorIsolationType = Readonly<{
  username: string;
  password: string;
}>;

// Tor's IsolateSOCKSAuth gives each credential pair its own circuits.
export function makeTorIsolation(randomHex: string): TorIsolationType {
  return { username: 'wren', password: randomHex };
}

// Always socks5h: plain socks5 resolves Signal's hostnames on this machine.
export function buildProxyUrl(
  settings: ProxySettingsType,
  torIsolation: TorIsolationType
): string | undefined {
  switch (settings.mode) {
    case 'off':
      return undefined;
    case 'tor':
      return (
        `socks5h://${userInfo(torIsolation.username, torIsolation.password)}` +
        `${TOR_HOST}:${settings.torPort}`
      );
    case 'socks5':
      return (
        `socks5h://${userInfo(settings.username, settings.password)}` +
        `${hostForUrl(settings.host)}:${settings.port}`
      );
    case 'http': {
      const url = parseHttpProxyUrl(settings.httpUrl);
      return url ? url.href.replace(/\/$/, '') : undefined;
    }
    default:
      return undefined;
  }
}

// No credentials: Chromium can't send them. Its socks5 resolves at the proxy.
export function buildChromiumRules(
  settings: ProxySettingsType
): string | undefined {
  switch (settings.mode) {
    case 'off':
      return undefined;
    case 'tor':
      return `socks5://${TOR_HOST}:${settings.torPort}`;
    case 'socks5':
      return `socks5://${hostForUrl(settings.host)}:${settings.port}`;
    case 'http': {
      const url = parseHttpProxyUrl(settings.httpUrl);
      if (!url) {
        return undefined;
      }
      let { port } = url;
      if (port === '') {
        port = url.protocol === 'https:' ? '443' : '80';
      }
      return `${url.protocol}//${url.hostname}:${port}`;
    }
    default:
      return undefined;
  }
}

export function upgradeLocalDnsScheme(proxyUrl: string): string {
  const match = /^(socks5|socks4|socks):\/\//i.exec(proxyUrl);
  if (!match) {
    return proxyUrl;
  }
  const scheme = match[1]?.toLowerCase();
  const replacement = scheme === 'socks4' ? 'socks4a' : 'socks5h';
  return `${replacement}://${proxyUrl.slice(match[0].length)}`;
}

export type ProxySourceType = 'none' | 'env' | 'settings' | 'blocked';

export type EffectiveProxyType = Readonly<{
  source: ProxySourceType;
  proxyUrl: string | undefined;
  chromiumRules: string | undefined;
  onlyThroughProxy: boolean;
}>;

export type ResolveProxyOptionsType = Readonly<{
  envProxyUrl: string | undefined;
  hasProxyServerFlag: boolean;
  stored: StoredProxySettingsType;
  torIsolation: TorIsolationType;
}>;

export function resolveEffectiveProxy({
  envProxyUrl,
  hasProxyServerFlag,
  stored,
  torIsolation,
}: ResolveProxyOptionsType): EffectiveProxyType {
  const env = envProxyUrl?.trim() || undefined;

  if (stored.kind === 'unreadable') {
    return {
      source: env ? 'env' : 'blocked',
      proxyUrl: env ? upgradeLocalDnsScheme(env) : BLOCKED_PROXY_URL,
      chromiumRules: hasProxyServerFlag ? undefined : BLOCKED_CHROMIUM_RULES,
      onlyThroughProxy: true,
    };
  }

  const settings =
    stored.kind === 'ok' ? stored.settings : DEFAULT_PROXY_SETTINGS;
  const settingsOn = settings.mode !== 'off';
  const settingsUrl = settingsOn
    ? buildProxyUrl(settings, torIsolation)
    : undefined;
  const settingsRules = settingsOn ? buildChromiumRules(settings) : undefined;

  if (settingsOn && (!settingsUrl || !settingsRules)) {
    return {
      source: env ? 'env' : 'blocked',
      proxyUrl: env ? upgradeLocalDnsScheme(env) : BLOCKED_PROXY_URL,
      chromiumRules: hasProxyServerFlag ? undefined : BLOCKED_CHROMIUM_RULES,
      onlyThroughProxy: true,
    };
  }

  const chromiumRules = hasProxyServerFlag ? undefined : settingsRules;

  if (env) {
    return {
      source: 'env',
      proxyUrl: upgradeLocalDnsScheme(env),
      chromiumRules,
      onlyThroughProxy: settingsOn ? settings.onlyThroughProxy : false,
    };
  }

  if (settingsUrl) {
    return {
      source: 'settings',
      proxyUrl: settingsUrl,
      chromiumRules,
      onlyThroughProxy: settings.onlyThroughProxy,
    };
  }

  return {
    source: 'none',
    proxyUrl: undefined,
    chromiumRules: undefined,
    onlyThroughProxy: false,
  };
}

// Debug logs get uploaded: no credentials, no remote hostnames.
export function describeProxyForLog(effective: EffectiveProxyType): string {
  if (effective.source === 'none' || effective.proxyUrl === undefined) {
    return 'no proxy';
  }
  const parts = [
    `${effective.source} ${describeProxyUrlForLog(effective.proxyUrl)}`,
  ];
  if (effective.onlyThroughProxy) {
    parts.push('only through proxy');
  }
  if (effective.chromiumRules) {
    parts.push('chromium via settings');
  }
  return parts.join(', ');
}

export function describeProxyUrlForLog(proxyUrl: string): string {
  let url: URL;
  try {
    url = new URL(proxyUrl);
  } catch {
    return 'unparseable proxy';
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const where =
    host === 'localhost' || host === '::1' || host.startsWith('127.')
      ? `loopback:${url.port || 'default'}`
      : 'remote host';
  const auth = url.username !== '' ? ', with credentials' : '';
  return `${url.protocol.replace(/:$/, '')} on ${where}${auth}`;
}

export function getProxyEndpoint(
  proxyUrl: string
): { host: string; port: number } | undefined {
  let url: URL;
  try {
    url = new URL(proxyUrl);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  let defaultPort: number;
  if (url.protocol === 'http:') {
    defaultPort = 80;
  } else if (url.protocol === 'https:') {
    defaultPort = 443;
  } else if (url.protocol.startsWith('socks')) {
    defaultPort = SOCKS_DEFAULT_PORT;
  } else {
    return undefined;
  }
  const port = url.port === '' ? defaultPort : Number.parseInt(url.port, 10);
  if (!host || !isValidPort(port)) {
    return undefined;
  }
  return { host, port };
}

export type DirectFeatureType = 'calls' | 'gif-search' | 'outage-dns-check';

export function isDirectFeatureAllowed(
  effective: Pick<EffectiveProxyType, 'proxyUrl' | 'onlyThroughProxy'>,
  feature: DirectFeatureType
): boolean {
  if (effective.proxyUrl === undefined) {
    return true;
  }
  if (feature === 'outage-dns-check') {
    // A plain DNS lookup of uptime.signal.org gives Signal use away.
    return false;
  }
  return !effective.onlyThroughProxy;
}
