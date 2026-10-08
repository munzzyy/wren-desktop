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

// Wayland reports a system idle time of 0 forever, so Wren also keeps its own
// clock of the last input in its windows and goes by whichever is longer.
export function getIdleSeconds({
  systemIdleSeconds,
  lastActivityMs,
  nowMs,
}: Readonly<{
  systemIdleSeconds: number;
  lastActivityMs: number;
  nowMs: number;
}>): number {
  const appIdleSeconds = Math.max(
    0,
    Math.floor((nowMs - lastActivityMs) / 1000)
  );
  const systemIdle = Number.isFinite(systemIdleSeconds) ? systemIdleSeconds : 0;
  return Math.max(systemIdle, appIdleSeconds);
}

// For wipe-after and auto-lock, 0 means off and a bigger number gives an
// attacker more room, so either direction away from strict is weaker.
export function isWeakerLimit(current: number, next: number): boolean {
  if (next === current || current === 0) {
    return false;
  }
  return next === 0 || next > current;
}

export function shouldAutoLock(
  autoLockMinutes: AutoLockMinutesType,
  idleSeconds: number
): boolean {
  return autoLockMinutes > 0 && idleSeconds >= autoLockMinutes * 60;
}

export type WrappedKeyStateType = Readonly<{
  salt: string;
  nonce: string;
  wrappedKey: string;
}>;

export type LockStateType = Readonly<{
  version: 1;
  salt: string;
  nonce: string;
  wrappedKey: string;
  duress?: Readonly<{ salt: string; verifier: string }>;
  // The database key from before a rekey that hasn't finished yet.
  previous?: WrappedKeyStateType;
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
    previous,
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

  let parsedPrevious: LockStateType['previous'];
  if (previous !== undefined) {
    if (
      !isRecord(previous) ||
      !isHexString(previous.salt) ||
      !isHexString(previous.nonce) ||
      !isHexString(previous.wrappedKey)
    ) {
      return undefined;
    }
    parsedPrevious = {
      salt: previous.salt,
      nonce: previous.nonce,
      wrappedKey: previous.wrappedKey,
    };
  }

  return {
    version: 1,
    salt,
    nonce,
    wrappedKey,
    ...(parsedDuress ? { duress: parsedDuress } : {}),
    ...(parsedPrevious ? { previous: parsedPrevious } : {}),
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
    ...(state.previous
      ? {
          previous: {
            salt: state.previous.salt,
            nonce: state.previous.nonce,
            wrappedKey: state.previous.wrappedKey,
          },
        }
      : {}),
    wipeAfter: state.wipeAfter,
    failedAttempts: state.failedAttempts,
    autoLockMinutes: state.autoLockMinutes,
    lockOnSystemLock: state.lockOnSystemLock,
  };
}
