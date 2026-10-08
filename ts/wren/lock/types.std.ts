// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import type { WipeAfterType } from './failedAttemptPolicy.std.ts';
import type { AutoLockMinutesType } from './lockState.std.ts';

export const MIN_PASSPHRASE_LENGTH = 8;
export const MAX_PASSPHRASE_LENGTH = 1024;

export type LockStatusType = Readonly<{
  enabled: boolean;
  hasDuress: boolean;
  wipeAfter: WipeAfterType;
  autoLockMinutes: AutoLockMinutesType;
  lockOnSystemLock: boolean;
}>;

export type LockErrorType =
  | 'wrong-passphrase'
  | 'too-short'
  | 'same-as-passphrase'
  | 'same-as-duress'
  | 'not-enabled'
  | 'already-enabled'
  | 'failed';

export type LockResultType = Readonly<
  { ok: true; status: LockStatusType } | { ok: false; error: LockErrorType }
>;

export type LockSettingsApiType = Readonly<{
  getStatus: () => Promise<LockStatusType>;
  enable: (passphrase: string) => Promise<LockResultType>;
  change: (current: string, next: string) => Promise<LockResultType>;
  disable: (current: string) => Promise<LockResultType>;
  setDuress: (duress: string) => Promise<LockResultType>;
  clearDuress: () => Promise<LockResultType>;
  setWipeAfter: (value: WipeAfterType) => Promise<LockResultType>;
  setAutoLockMinutes: (value: AutoLockMinutesType) => Promise<LockResultType>;
  setLockOnSystemLock: (value: boolean) => Promise<LockResultType>;
  lockNow: () => void;
}>;

export type UnlockResultType = Readonly<
  | { status: 'unlocked' }
  | { status: 'wrong'; message: string }
  | { status: 'busy' }
>;

export type LockWindowInfoType = Readonly<{
  theme: 'light' | 'dark';
  strings: Readonly<{
    title: string;
    prompt: string;
    placeholder: string;
    unlock: string;
    checking: string;
  }>;
}>;

export type LockWindowApiType = Readonly<{
  getInfo: () => Promise<LockWindowInfoType>;
  unlock: (passphrase: string) => Promise<UnlockResultType>;
}>;

export const LockIpc = {
  getStatus: 'wren-lock:get-status',
  enable: 'wren-lock:enable',
  change: 'wren-lock:change',
  disable: 'wren-lock:disable',
  setDuress: 'wren-lock:set-duress',
  clearDuress: 'wren-lock:clear-duress',
  setWipeAfter: 'wren-lock:set-wipe-after',
  setAutoLockMinutes: 'wren-lock:set-auto-lock-minutes',
  setLockOnSystemLock: 'wren-lock:set-lock-on-system-lock',
  lockNow: 'wren-lock:lock-now',
  windowInfo: 'wren-lock:window-info',
  unlock: 'wren-lock:unlock',
} as const;

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Window {
    WrenLockWindow?: LockWindowApiType;
  }
}
