// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

export const WIPE_AFTER_OPTIONS = [0, 5, 10, 20] as const;
export type WipeAfterType = (typeof WIPE_AFTER_OPTIONS)[number];

export function isWipeAfter(value: unknown): value is WipeAfterType {
  return WIPE_AFTER_OPTIONS.some(option => option === value);
}

export type FailedAttemptOutcomeType = Readonly<{
  failedAttempts: number;
  shouldWipe: boolean;
  remaining: number | undefined;
}>;

export function recordFailedAttempt(
  failedAttempts: number,
  wipeAfter: WipeAfterType
): FailedAttemptOutcomeType {
  const next = Math.max(0, Math.floor(failedAttempts)) + 1;
  if (wipeAfter === 0) {
    return { failedAttempts: next, shouldWipe: false, remaining: undefined };
  }
  return {
    failedAttempts: next,
    shouldWipe: next >= wipeAfter,
    remaining: Math.max(0, wipeAfter - next),
  };
}

export function resetFailedAttempts(): number {
  return 0;
}
