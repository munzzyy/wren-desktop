// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import type { DuressVerifierType } from './duressVerifier.node.ts';
import { createDecoyVerifier, matchesDuress } from './duressVerifier.node.ts';
import type { FailedAttemptOutcomeType } from './failedAttemptPolicy.std.ts';
import {
  recordFailedAttempt,
  resetFailedAttempts,
} from './failedAttemptPolicy.std.ts';
import { unwrapKey } from './keyWrap.node.ts';
import type { LockStateType } from './lockState.std.ts';

export type UnlockAttemptDepsType = Readonly<{
  writeState: (state: LockStateType) => void;
  unwrap?: (state: LockStateType, passphrase: string) => string | undefined;
  matchesDuress?: (passphrase: string, duress: DuressVerifierType) => boolean;
  onResetFailed?: (error: unknown) => void;
}>;

export type UnlockAttemptResultType = Readonly<
  | { kind: 'unlocked'; key: string }
  | { kind: 'duress' }
  | { kind: 'wrong'; outcome: FailedAttemptOutcomeType }
  | { kind: 'not-counted'; error: unknown }
>;

// The attempt is on disk before scrypt starts, so killing the app mid-check
// never gives a free guess. Both derivations always run, against a random
// decoy when no duress passphrase is set, so a wrong guess takes the same
// time either way.
export function attemptUnlock(
  state: LockStateType,
  passphrase: string,
  {
    writeState,
    unwrap = unwrapKey,
    matchesDuress: matches = matchesDuress,
    onResetFailed,
  }: UnlockAttemptDepsType
): UnlockAttemptResultType {
  const outcome = recordFailedAttempt(state.failedAttempts, state.wipeAfter);
  try {
    writeState({ ...state, failedAttempts: outcome.failedAttempts });
  } catch (error) {
    return { kind: 'not-counted', error };
  }

  const key = unwrap(state, passphrase);
  const isDuress = matches(passphrase, state.duress ?? createDecoyVerifier());

  if (key !== undefined) {
    try {
      writeState({ ...state, failedAttempts: resetFailedAttempts() });
    } catch (error) {
      onResetFailed?.(error);
    }
    return { kind: 'unlocked', key };
  }
  if (state.duress !== undefined && isDuress) {
    return { kind: 'duress' };
  }
  return { kind: 'wrong', outcome };
}
