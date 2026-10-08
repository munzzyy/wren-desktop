// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from 'node:crypto';
import { ipcMain } from 'electron';

import type { LoggerType } from '../../types/Logging.std.ts';
import * as Errors from '../../types/errors.std.ts';
import type {
  EffectiveProxyType,
  ProxySettingsType,
  StoredProxySettingsType,
  TorIsolationType,
} from './proxyConfig.std.ts';
import {
  DEFAULT_PROXY_SETTINGS,
  PROXY_CONFIG_KEY,
  buildProxyUrl,
  describeProxyForLog,
  makeTorIsolation,
  parseStoredProxySettings,
  resolveEffectiveProxy,
  serializeProxySettings,
  validateProxySettings,
} from './proxyConfig.std.ts';
import { probeProxy, testThroughProxy } from './proxyCheck.node.ts';
import { setActiveProxy } from './activeProxy.std.ts';
import type {
  ProxyProbeResultType,
  ProxySaveResultType,
  ProxyStatusType,
  ProxyTestResultType,
} from './types.std.ts';
import { ProxyIpc } from './types.std.ts';

type ProxyConfigStoreType = Readonly<{
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}>;

type CommandLineType = Readonly<{
  hasSwitch: (name: string) => boolean;
  appendSwitch: (name: string, value?: string) => void;
}>;

export type ProxyControllerOptionsType = Readonly<{
  config: ProxyConfigStoreType;
  commandLine: CommandLineType;
  envProxyUrl: string | undefined;
  log: LoggerType;
  getServerUrl: () => string;
  getCertificateAuthority: () => string;
}>;

export class ProxyController {
  readonly effective: EffectiveProxyType;

  readonly #options: ProxyControllerOptionsType;
  readonly #torIsolation: TorIsolationType;
  readonly #startupStored: StoredProxySettingsType;
  readonly #flagOverride: boolean;

  constructor(options: ProxyControllerOptionsType) {
    this.#options = options;
    this.#torIsolation = makeTorIsolation(randomBytes(16).toString('hex'));
    this.#flagOverride = options.commandLine.hasSwitch('proxy-server');
    this.#startupStored = parseStoredProxySettings(
      options.config.get(PROXY_CONFIG_KEY)
    );

    if (this.#startupStored.kind === 'unreadable') {
      options.log.error(
        'wren-proxy: proxy settings in config.json are unreadable, ' +
          'not connecting until they are saved again'
      );
    }

    this.effective = resolveEffectiveProxy({
      envProxyUrl: options.envProxyUrl,
      hasProxyServerFlag: this.#flagOverride,
      stored: this.#startupStored,
      torIsolation: this.#torIsolation,
    });
    setActiveProxy(this.effective);
    options.log.info(`wren-proxy: ${describeProxyForLog(this.effective)}`);
  }

  // Has to run before app 'ready' or Chromium ignores it.
  applyToChromium(): void {
    const { chromiumRules } = this.effective;
    if (chromiumRules === undefined) {
      return;
    }
    this.#options.commandLine.appendSwitch('proxy-server', chromiumRules);
  }

  installHandlers(): void {
    ipcMain.handle(ProxyIpc.getStatus, async () => this.#getStatus());
    ipcMain.handle(ProxyIpc.save, async (_event, input: unknown) =>
      this.#save(input)
    );
    ipcMain.handle(ProxyIpc.test, async (_event, input: unknown) =>
      this.#test(input)
    );
    ipcMain.handle(ProxyIpc.probe, async () => this.#probe());
    ipcMain.handle(ProxyIpc.check, async () => this.#check());
  }

  #readStored(): StoredProxySettingsType {
    return parseStoredProxySettings(this.#options.config.get(PROXY_CONFIG_KEY));
  }

  #getStatus(): ProxyStatusType {
    const stored = this.#readStored();
    const saved =
      stored.kind === 'ok' ? stored.settings : DEFAULT_PROXY_SETTINGS;
    const next = resolveEffectiveProxy({
      envProxyUrl: undefined,
      hasProxyServerFlag: false,
      stored,
      torIsolation: this.#torIsolation,
    });
    const now = resolveEffectiveProxy({
      envProxyUrl: undefined,
      hasProxyServerFlag: false,
      stored: this.#startupStored,
      torIsolation: this.#torIsolation,
    });
    return {
      saved,
      savedUnreadable: stored.kind === 'unreadable',
      activeSource: this.effective.source,
      activeOnlyThroughProxy: this.effective.onlyThroughProxy,
      envOverride: Boolean(this.#options.envProxyUrl?.trim()),
      flagOverride: this.#flagOverride,
      needsRelaunch:
        next.proxyUrl !== now.proxyUrl ||
        next.chromiumRules !== now.chromiumRules ||
        next.onlyThroughProxy !== now.onlyThroughProxy,
    };
  }

  #save(input: unknown): ProxySaveResultType {
    const result = validateProxySettings(input);
    if (!result.ok) {
      return result;
    }
    try {
      this.#options.config.set(
        PROXY_CONFIG_KEY,
        serializeProxySettings(result.settings)
      );
    } catch (error) {
      this.#options.log.error(
        'wren-proxy: saving settings failed',
        Errors.toLogFormat(error)
      );
      return { ok: false, error: 'invalid' };
    }
    this.#options.log.info(
      `wren-proxy: saved mode=${result.settings.mode}, ` +
        `onlyThroughProxy=${result.settings.onlyThroughProxy}`
    );
    return { ok: true, status: this.#getStatus() };
  }

  async #test(input: unknown): Promise<ProxyTestResultType> {
    const result = validateProxySettings(input);
    if (!result.ok) {
      return { result: 'invalid', error: result.error };
    }
    const settings: ProxySettingsType = result.settings;
    const proxyUrl = buildProxyUrl(settings, this.#torIsolation);
    if (proxyUrl === undefined) {
      return { result: 'off' };
    }
    try {
      const outcome = await testThroughProxy({
        proxyUrl,
        serverUrl: this.#options.getServerUrl(),
        certificateAuthority: this.#options.getCertificateAuthority(),
      });
      this.#options.log.info(
        `wren-proxy: test mode=${settings.mode} result=${outcome.result}`
      );
      return outcome;
    } catch {
      this.#options.log.warn(`wren-proxy: test mode=${settings.mode} threw`);
      return { result: 'server-unreachable' };
    }
  }

  async #check(): Promise<boolean> {
    const { proxyUrl } = this.effective;
    if (proxyUrl === undefined) {
      return false;
    }
    try {
      const outcome = await testThroughProxy({
        proxyUrl,
        serverUrl: this.#options.getServerUrl(),
        certificateAuthority: this.#options.getCertificateAuthority(),
      });
      return outcome.result === 'reachable';
    } catch {
      return false;
    }
  }

  async #probe(): Promise<ProxyProbeResultType> {
    const { proxyUrl } = this.effective;
    if (proxyUrl === undefined) {
      return { active: false, reachable: true };
    }
    return { active: true, reachable: await probeProxy(proxyUrl) };
  }
}
