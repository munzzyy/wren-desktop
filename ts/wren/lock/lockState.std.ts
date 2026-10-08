// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import type { WipeAfterType } from './failedAttemptPolicy.std.ts';
import { isWipeAfter } from './failedAttemptPolicy.std.ts';

export const LOCK_STATE_CONFIG_KEY = 'wrenLock';

export const AUTO_LOCK_OPTIONS = [0, 5, 15, 30, 60] as const;
export type AutoLockMinutesType = (typeof AUTO_LOCK_OPTIONS)[number];

export function isAutoLockMinutes(
  value: unknown
): value is AutoLockMinutesType {
  return AUTO_LOCK_OPTIONS.some(option => option === value);
}

export type LockStateType = Readonly<{
  version: 1;
  salt: string;
  nonce: string;
  wrappedKey: string;
  duress?: Readonly<{ salt: string; verifier: string }>;
  wipeAfter: WipeAfterType;
  failedAttempts: number;
  autoLockMinutes: AutoLockMinutesType;
  lockOnSystemLock: boolean;
}>;

const HEX = /^(?:[0-9a-f]{2})+$/;

function isHexString(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

export function parseLockState(value: unknown): LockStateType | undefined {
  if (!isRecord(value) || value.version !== 1) {
    return undefined;
  }

  const {
    salt,
    nonce,
    wrappedKey,
    duress,
    wipeAfter,
    failedAttempts,
    autoLockMinutes,
    lockOnSystemLock,
  } = value;

  if (!isHexString(salt) || !isHexString(nonce) || !isHexString(wrappedKey)) {
    return undefined;
  }

  let parsedDuress: LockStateType['duress'];
  if (duress !== undefined) {
    if (
      !isRecord(duress) ||
      !isHexString(duress.salt) ||
      !isHexString(duress.verifier)
    ) {
      return undefined;
    }
    parsedDuress = { salt: duress.salt, verifier: duress.verifier };
  }

  return {
    version: 1,
    salt,
    nonce,
    wrappedKey,
    ...(parsedDuress ? { duress: parsedDuress } : {}),
    wipeAfter: isWipeAfter(wipeAfter) ? wipeAfter : 0,
    failedAttempts:
      typeof failedAttempts === 'number' &&
      Number.isSafeInteger(failedAttempts) &&
      failedAttempts >= 0
        ? failedAttempts
        : 0,
    autoLockMinutes: isAutoLockMinutes(autoLockMinutes) ? autoLockMinutes : 0,
    lockOnSystemLock: lockOnSystemLock === true,
  };
}

export function serializeLockState(
  state: LockStateType
): Record<string, unknown> {
  return {
    version: state.version,
    salt: state.salt,
    nonce: state.nonce,
    wrappedKey: state.wrappedKey,
    ...(state.duress
      ? {
          duress: { salt: state.duress.salt, verifier: state.duress.verifier },
        }
      : {}),
    wipeAfter: state.wipeAfter,
    failedAttempts: state.failedAttempts,
    autoLockMinutes: state.autoLockMinutes,
    lockOnSystemLock: state.lockOnSystemLock,
  };
}
