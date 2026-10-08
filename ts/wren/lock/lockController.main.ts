// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  webContents,
} from 'electron';

import type { LoggerType } from '../../types/Logging.std.ts';
import type { LocalizerType } from '../../types/I18N.std.ts';
import { explodePromise } from '../../util/explodePromise.std.ts';
import * as Errors from '../../types/errors.std.ts';
import { count as countGraphemes } from '../../util/grapheme.std.ts';
import { unwrapKey, wrapKey } from './keyWrap.node.ts';
import { createDuressVerifier, matchesDuress } from './duressVerifier.node.ts';
import { attemptUnlock } from './unlockAttempt.node.ts';
import { isWipeAfter, resetFailedAttempts } from './failedAttemptPolicy.std.ts';
import type { LockStateType } from './lockState.std.ts';
import {
  LOCK_STATE_CONFIG_KEY,
  getIdleSeconds,
  isAutoLockMinutes,
  isWeakerLimit,
  parseLockState,
  serializeLockState,
  shouldAutoLock,
} from './lockState.std.ts';
import type {
  LockErrorType,
  LockResultType,
  LockStatusType,
  LockWindowInfoType,
  UnlockResultType,
} from './types.std.ts';
import {
  LockIpc,
  MAX_PASSPHRASE_LENGTH,
  MIN_PASSPHRASE_LENGTH,
} from './types.std.ts';
import { wipeAndExit } from './wipe.main.ts';

const KEYCHAIN_CONFIG_KEYS = ['encryptedKey', 'key', 'safeStorageBackend'];
const IDLE_CHECK_INTERVAL = 15 * 1000;

export type LockConfigType = Readonly<{
  get: (keyPath: string) => unknown;
  set: (keyPath: string, value: unknown) => void;
}>;

export type LockControllerOptionsType = Readonly<{
  config: LockConfigType;
  log: LoggerType;
  rootDir: string;
  windowIcon: string;
  devTools: boolean;
  getI18n: () => LocalizerType;
  getTheme: () => Promise<'light' | 'dark'>;
  getSqlKeyFromKeychain: () => string;
  rekeyDatabase: (key: string) => Promise<void>;
  isMainWindowSender: (sender: WebContents) => boolean;
  beforeLock?: () => void;
  relaunch: () => void;
  loadURL: (window: BrowserWindow, url: string) => Promise<void>;
}>;

export type UnlockedKeyType = Readonly<{
  key: string;
  // Set only when a rekey was cut short; the database opens under one of them.
  previousKey?: string;
}>;

function isPassphrase(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PASSPHRASE_LENGTH;
}

function isLongEnough(passphrase: string): boolean {
  return countGraphemes(passphrase) >= MIN_PASSPHRASE_LENGTH;
}

function failure(error: LockErrorType): LockResultType {
  return { ok: false, error };
}

export class LockController {
  readonly #options: LockControllerOptionsType;

  #lockWindow: BrowserWindow | undefined;

  #unlockPending = false;

  #busy = false;

  #autoLockStarted = false;

  #lastActivityMs = Date.now();

  constructor(options: LockControllerOptionsType) {
    this.#options = options;
  }

  isEnabled(): boolean {
    return this.#options.config.get(LOCK_STATE_CONFIG_KEY) !== undefined;
  }

  focusLockWindow(): void {
    if (!this.#lockWindow) {
      return;
    }
    if (this.#lockWindow.isMinimized()) {
      this.#lockWindow.restore();
    }
    this.#lockWindow.focus();
  }

  async waitForUnlock(userDataPath: string): Promise<UnlockedKeyType> {
    const { log, getI18n } = this.#options;
    const initial = this.#readState();
    if (!initial) {
      log.error('wren-lock: lock settings in config.json are unreadable');
      const i18n = getI18n();
      dialog.showMessageBoxSync({
        type: 'error',
        message: i18n('icu:WrenLock__unreadable'),
        detail: i18n('icu:WrenLock__unreadable-detail'),
        noLink: true,
      });
      app.exit(1);
      return new Promise<UnlockedKeyType>(() => undefined);
    }

    this.#unlockPending = true;
    const { promise, resolve } = explodePromise<UnlockedKeyType>();
    const window = await this.#createLockWindow();
    let unlocked = false;

    window.on('closed', () => {
      this.#lockWindow = undefined;
      if (!unlocked) {
        log.info('wren-lock: lock window closed without unlocking, quitting');
        app.exit(0);
      }
    });

    const isFromLockWindow = (event: IpcMainInvokeEvent) =>
      !window.isDestroyed() && event.sender === window.webContents;

    ipcMain.handle(LockIpc.windowInfo, async event => {
      if (!isFromLockWindow(event)) {
        throw new Error('wren-lock: window info from an unknown sender');
      }
      return this.#getWindowInfo();
    });

    ipcMain.handle(
      LockIpc.unlock,
      async (event, passphrase: unknown): Promise<UnlockResultType> => {
        if (!isFromLockWindow(event) || !isPassphrase(passphrase)) {
          throw new Error('wren-lock: bad unlock request');
        }
        if (this.#busy || unlocked) {
          return { status: 'busy' };
        }

        this.#busy = true;
        try {
          const result = await this.#tryUnlock(passphrase, userDataPath);
          if ('key' in result) {
            unlocked = true;
            resolve(result);
            setImmediate(() => {
              if (!window.isDestroyed()) {
                window.destroy();
              }
            });
            return { status: 'unlocked' };
          }
          return result;
        } finally {
          this.#busy = false;
        }
      }
    );

    await this.#options.loadURL(
      window,
      pathToFileURL(join(this.#options.rootDir, 'lock.html')).href
    );

    try {
      return await promise;
    } finally {
      ipcMain.removeHandler(LockIpc.windowInfo);
      ipcMain.removeHandler(LockIpc.unlock);
      this.#unlockPending = false;
    }
  }

  installSettingsHandlers(): void {
    const { log, isMainWindowSender } = this.#options;
    const fromMainWindow = (event: IpcMainInvokeEvent | IpcMainEvent) =>
      isMainWindowSender(event.sender) &&
      event.senderFrame === event.sender.mainFrame;

    const handle = (
      channel: string,
      fn: (...args: Array<unknown>) => LockResultType | Promise<LockResultType>
    ) => {
      ipcMain.handle(channel, async (event, ...args: Array<unknown>) => {
        if (!fromMainWindow(event)) {
          throw new Error(`wren-lock: ${channel} from an unknown sender`);
        }
        if (this.#unlockPending) {
          return failure('failed');
        }
        try {
          return await fn(...args);
        } catch (error) {
          log.error(`wren-lock: ${channel} failed`, Errors.toLogFormat(error));
          return failure('failed');
        }
      });
    };

    ipcMain.handle(LockIpc.getStatus, async event => {
      if (!fromMainWindow(event)) {
        throw new Error('wren-lock: status from an unknown sender');
      }
      return this.#getStatus();
    });
    handle(LockIpc.enable, passphrase => this.#enable(passphrase));
    handle(LockIpc.change, (current, next) => this.#change(current, next));
    handle(LockIpc.disable, current => this.#disable(current));
    handle(LockIpc.setDuress, duress => this.#setDuress(duress));
    handle(LockIpc.clearDuress, current =>
      this.#updateWithPassphrase(current, state => ({
        ...state,
        duress: undefined,
      }))
    );
    handle(LockIpc.setWipeAfter, (value, current) => {
      if (!isWipeAfter(value)) {
        return failure('failed');
      }
      return this.#updateSetting(
        current,
        state => isWeakerLimit(state.wipeAfter, value),
        state => ({
          ...state,
          wipeAfter: value,
          failedAttempts: resetFailedAttempts(),
        })
      );
    });
    handle(LockIpc.setAutoLockMinutes, (value, current) => {
      if (!isAutoLockMinutes(value)) {
        return failure('failed');
      }
      return this.#updateSetting(
        current,
        state => isWeakerLimit(state.autoLockMinutes, value),
        state => ({ ...state, autoLockMinutes: value })
      );
    });
    handle(LockIpc.setLockOnSystemLock, (value, current) => {
      if (typeof value !== 'boolean') {
        return failure('failed');
      }
      return this.#updateSetting(
        current,
        state => state.lockOnSystemLock && !value,
        state => ({ ...state, lockOnSystemLock: value })
      );
    });
    ipcMain.on(LockIpc.lockNow, event => {
      if (fromMainWindow(event)) {
        this.lockFromMenu();
      }
    });
  }

  // For callers outside the settings page, like starting a chat export.
  checkPassphrase(passphrase: unknown): 'not-enabled' | 'ok' | 'wrong' {
    const state = this.#readState();
    if (!state) {
      return 'not-enabled';
    }
    return isPassphrase(passphrase) &&
      unwrapKey(state, passphrase) !== undefined
      ? 'ok'
      : 'wrong';
  }

  startAutoLock(): void {
    if (this.#autoLockStarted) {
      return;
    }
    this.#autoLockStarted = true;

    const onSystemLock = () => {
      if (this.#readState()?.lockOnSystemLock) {
        this.#lockNow('system lock');
      }
    };
    powerMonitor.on('lock-screen', onSystemLock);
    powerMonitor.on('suspend', onSystemLock);

    this.#lastActivityMs = Date.now();
    const watch = (contents: WebContents) => {
      contents.on('before-input-event', () => this.#noteActivity());
    };
    for (const contents of webContents.getAllWebContents()) {
      watch(contents);
    }
    app.on('web-contents-created', (_event, contents) => watch(contents));
    ipcMain.on(LockIpc.activity, event => {
      if (BrowserWindow.fromWebContents(event.sender) != null) {
        this.#noteActivity();
      }
    });

    setInterval(() => this.#checkAutoLock(), IDLE_CHECK_INTERVAL).unref();
  }

  #noteActivity(): void {
    this.#lastActivityMs = Date.now();
  }

  #checkAutoLock(): void {
    const state = this.#readState();
    if (!state) {
      return;
    }
    // Linux desktops that never send lock-screen still report 'locked' here.
    if (
      state.lockOnSystemLock &&
      powerMonitor.getSystemIdleState(1) === 'locked'
    ) {
      this.#lockNow('system lock');
      return;
    }
    const idleSeconds = getIdleSeconds({
      systemIdleSeconds: powerMonitor.getSystemIdleTime(),
      lastActivityMs: this.#lastActivityMs,
      nowMs: Date.now(),
    });
    if (shouldAutoLock(state.autoLockMinutes, idleSeconds)) {
      this.#lockNow('idle');
    }
  }

  lockFromMenu(): void {
    if (this.#unlockPending) {
      return;
    }
    if (this.#readState()) {
      this.#lockNow('menu');
      return;
    }
    const i18n = this.#options.getI18n();
    void dialog.showMessageBox({
      type: 'info',
      message: i18n('icu:WrenLock__not-enabled'),
      noLink: true,
    });
  }

  #lockNow(reason: string): void {
    this.#options.log.info(`wren-lock: locking (${reason})`);
    for (const window of BrowserWindow.getAllWindows()) {
      window.hide();
    }
    try {
      this.#options.beforeLock?.();
    } catch (error) {
      this.#options.log.error(
        'wren-lock: cleanup before locking failed',
        Errors.toLogFormat(error)
      );
    }
    this.#options.relaunch();
    app.exit(0);
  }

  #readState(): LockStateType | undefined {
    return parseLockState(this.#options.config.get(LOCK_STATE_CONFIG_KEY));
  }

  #writeState(state: LockStateType | undefined): void {
    this.#options.config.set(
      LOCK_STATE_CONFIG_KEY,
      state ? serializeLockState(state) : undefined
    );
  }

  #scrubKeychainKey(): void {
    const { config } = this.#options;
    for (const key of KEYCHAIN_CONFIG_KEYS) {
      if (config.get(key) !== undefined) {
        config.set(key, undefined);
      }
    }
  }

  #getStatus(): LockStatusType {
    const state = this.#readState();
    return {
      enabled: state !== undefined,
      hasDuress: state?.duress !== undefined,
      wipeAfter: state?.wipeAfter ?? 0,
      autoLockMinutes: state?.autoLockMinutes ?? 0,
      lockOnSystemLock: state?.lockOnSystemLock ?? false,
    };
  }

  #ok(): LockResultType {
    return { ok: true, status: this.#getStatus() };
  }

  // Anything that makes the lock weaker needs the passphrase, so someone at
  // an unlocked Wren can't quietly switch the protections off.
  #updateSetting(
    current: unknown,
    isWeaker: (state: LockStateType) => boolean,
    fn: (state: LockStateType) => LockStateType
  ): LockResultType {
    const state = this.#readState();
    if (!state) {
      return failure('not-enabled');
    }
    return isWeaker(state)
      ? this.#updateWithPassphrase(current, fn)
      : this.#update(fn);
  }

  #updateWithPassphrase(
    current: unknown,
    fn: (state: LockStateType) => LockStateType
  ): LockResultType {
    const state = this.#readState();
    if (!state) {
      return failure('not-enabled');
    }
    if (!isPassphrase(current) || unwrapKey(state, current) === undefined) {
      return failure('wrong-passphrase');
    }
    return this.#update(fn);
  }

  #update(fn: (state: LockStateType) => LockStateType): LockResultType {
    const state = this.#readState();
    if (!state) {
      return failure('not-enabled');
    }
    this.#writeState(fn(state));
    return this.#ok();
  }

  // The lock gets a database key of its own, so a copy of config.json or a
  // backup from before still holds only the old key, which no longer opens
  // anything. The old key stays wrapped next to the new one until the rekey
  // is done, so a crash in between is finished on the next unlock.
  async #enable(passphrase: unknown): Promise<LockResultType> {
    if (!isPassphrase(passphrase)) {
      return failure('failed');
    }
    if (this.isEnabled()) {
      return failure('already-enabled');
    }
    if (!isLongEnough(passphrase)) {
      return failure('too-short');
    }

    const { getSqlKeyFromKeychain, rekeyDatabase, log } = this.#options;
    const oldKey = getSqlKeyFromKeychain();
    const newKey = randomBytes(32).toString('hex');
    const pending: LockStateType = {
      version: 1,
      ...wrapKey(newKey, passphrase),
      previous: wrapKey(oldKey, passphrase),
      wipeAfter: 0,
      failedAttempts: 0,
      autoLockMinutes: 0,
      lockOnSystemLock: false,
    };
    this.#writeState(pending);

    const written = this.#readState();
    if (
      !written ||
      written.previous?.wrappedKey !== pending.previous?.wrappedKey ||
      unwrapKey(written, passphrase) !== newKey
    ) {
      this.#writeState(undefined);
      return failure('failed');
    }

    this.#scrubKeychainKey();
    try {
      await rekeyDatabase(newKey);
    } catch (error) {
      log.error(
        'wren-lock: the database rekey failed, restarting to finish it',
        Errors.toLogFormat(error)
      );
      setImmediate(() => this.#lockNow('rekey'));
      return failure('failed');
    }

    this.finishPendingRekey();
    log.info('wren-lock: passphrase lock turned on with a new database key');
    return this.#ok();
  }

  finishPendingRekey(): void {
    const state = this.#readState();
    if (state?.previous) {
      this.#writeState({ ...state, previous: undefined });
      this.#options.log.info('wren-lock: database rekey finished');
    }
  }

  #change(current: unknown, next: unknown): LockResultType {
    const state = this.#readState();
    if (!state) {
      return failure('not-enabled');
    }
    if (!isPassphrase(current) || !isPassphrase(next) || state.previous) {
      return failure('failed');
    }
    if (!isLongEnough(next)) {
      return failure('too-short');
    }
    const key = unwrapKey(state, current);
    if (key === undefined) {
      return failure('wrong-passphrase');
    }
    if (state.duress && matchesDuress(next, state.duress)) {
      return failure('same-as-duress');
    }

    this.#writeState({ ...state, ...wrapKey(key, next) });
    this.#options.log.info('wren-lock: passphrase changed');
    return this.#ok();
  }

  #disable(current: unknown): LockResultType {
    const state = this.#readState();
    if (!state) {
      return failure('not-enabled');
    }
    if (!isPassphrase(current) || state.previous) {
      return failure('failed');
    }
    const key = unwrapKey(state, current);
    if (key === undefined) {
      return failure('wrong-passphrase');
    }

    const { config, getSqlKeyFromKeychain, log } = this.#options;
    config.set('key', key);
    this.#writeState(undefined);
    if (getSqlKeyFromKeychain() !== key) {
      log.error('wren-lock: restored key does not match, keeping plaintext');
      config.set('key', key);
    }
    log.info('wren-lock: passphrase lock turned off');
    return this.#ok();
  }

  #setDuress(duress: unknown): LockResultType {
    const state = this.#readState();
    if (!state) {
      return failure('not-enabled');
    }
    if (!isPassphrase(duress)) {
      return failure('failed');
    }
    if (!isLongEnough(duress)) {
      return failure('too-short');
    }
    if (unwrapKey(state, duress) !== undefined) {
      return failure('same-as-passphrase');
    }
    this.#writeState({ ...state, duress: createDuressVerifier(duress) });
    this.#options.log.info('wren-lock: duress passphrase set');
    return this.#ok();
  }

  async #tryUnlock(
    passphrase: string,
    userDataPath: string
  ): Promise<UnlockedKeyType | UnlockResultType> {
    const state = this.#readState();
    if (!state) {
      throw new Error('wren-lock: lock settings disappeared');
    }

    const { log } = this.#options;
    const attempt = attemptUnlock(state, passphrase, {
      writeState: next => this.#writeState(next),
      onResetFailed: error =>
        log.error(
          'wren-lock: could not reset the attempt count',
          Errors.toLogFormat(error)
        ),
    });

    if (attempt.kind === 'not-counted') {
      log.error(
        'wren-lock: could not save the attempt count, refusing the attempt',
        Errors.toLogFormat(attempt.error)
      );
      return {
        status: 'wrong',
        message: this.#options.getI18n()('icu:WrenLock__not-counted'),
      };
    }
    if (attempt.kind === 'unlocked') {
      this.#scrubKeychainKey();
      log.info('wren-lock: unlocked');
      const previousKey = state.previous
        ? unwrapKey(state.previous, passphrase)
        : undefined;
      return previousKey === undefined
        ? { key: attempt.key }
        : { key: attempt.key, previousKey };
    }
    if (attempt.kind === 'duress') {
      await this.#wipe(userDataPath);
      return { status: 'busy' };
    }

    const { outcome } = attempt;
    log.warn(
      `wren-lock: wrong passphrase (${outcome.failedAttempts} in a row)`
    );

    if (outcome.shouldWipe) {
      await this.#wipe(userDataPath);
      return { status: 'busy' };
    }

    const i18n = this.#options.getI18n();
    return {
      status: 'wrong',
      message:
        outcome.remaining === undefined
          ? i18n('icu:WrenLock__wrong')
          : i18n('icu:WrenLock__wrong-with-remaining', {
              count: outcome.remaining,
            }),
    };
  }

  async #wipe(userDataPath: string): Promise<void> {
    if (this.#lockWindow && !this.#lockWindow.isDestroyed()) {
      this.#lockWindow.hide();
    }
    await wipeAndExit({ userDataPath, log: this.#options.log });
  }

  async #getWindowInfo(): Promise<LockWindowInfoType> {
    const i18n = this.#options.getI18n();
    return {
      theme: await this.#options.getTheme(),
      strings: {
        title: i18n('icu:WrenLock__title'),
        prompt: i18n('icu:WrenLock__prompt'),
        placeholder: i18n('icu:WrenLock__placeholder'),
        unlock: i18n('icu:WrenLock__unlock'),
        checking: i18n('icu:WrenLock__checking'),
      },
    };
  }

  async #createLockWindow(): Promise<BrowserWindow> {
    const { rootDir, windowIcon, devTools, getI18n, getTheme } = this.#options;
    const theme = await getTheme();

    const window = new BrowserWindow({
      width: 400,
      height: 460,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: getI18n()('icu:WrenLock__title'),
      autoHideMenuBar: true,
      backgroundColor: theme === 'dark' ? '#191919' : '#fafafa',
      icon: windowIcon,
      show: false,
      webPreferences: {
        devTools,
        spellcheck: false,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        sandbox: true,
        contextIsolation: true,
        preload: join(rootDir, 'bundles', 'preload', 'lock.js'),
      },
    });
    window.removeMenu();
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.once('ready-to-show', () => {
      window.show();
      window.focus();
    });

    this.#lockWindow = window;
    return window;
  }
}
