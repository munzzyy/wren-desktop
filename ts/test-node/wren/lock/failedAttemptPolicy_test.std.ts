// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { WipeAfterType } from '../../../wren/lock/failedAttemptPolicy.std.ts';
import {
  WIPE_AFTER_OPTIONS,
  isWipeAfter,
  recordFailedAttempt,
  resetFailedAttempts,
} from '../../../wren/lock/failedAttemptPolicy.std.ts';

function attemptsUntilWipe(limit: WipeAfterType, maxTries = 100): number {
  let failedAttempts = resetFailedAttempts();
  for (let tries = 1; tries <= maxTries; tries += 1) {
    const outcome = recordFailedAttempt(failedAttempts, limit);
    if (outcome.shouldWipe) {
      return tries;
    }
    failedAttempts = outcome.failedAttempts;
  }
  return Infinity;
}

describe('wren/lock/failedAttemptPolicy', () => {
  it('offers off, 5, 10 and 20', () => {
    assert.deepEqual([...WIPE_AFTER_OPTIONS], [0, 5, 10, 20]);
    assert.isTrue(isWipeAfter(10));
    assert.isFalse(isWipeAfter(3));
    assert.isFalse(isWipeAfter('5'));
  });

  it('wipes exactly at the limit, not one before', () => {
    for (const limit of [5, 10, 20] as const) {
      const before = recordFailedAttempt(limit - 2, limit);
      assert.isFalse(before.shouldWipe, `limit ${limit}, try ${limit - 1}`);
      assert.strictEqual(before.remaining, 1);

      const at = recordFailedAttempt(limit - 1, limit);
      assert.isTrue(at.shouldWipe, `limit ${limit}, try ${limit}`);
      assert.strictEqual(at.failedAttempts, limit);
      assert.strictEqual(at.remaining, 0);

      assert.strictEqual(attemptsUntilWipe(limit), limit);
    }
  });

  it('negative control: off never wipes', () => {
    assert.strictEqual(attemptsUntilWipe(0), Infinity);
    const outcome = recordFailedAttempt(1000, 0);
    assert.isFalse(outcome.shouldWipe);
    assert.isUndefined(outcome.remaining);
    assert.strictEqual(outcome.failedAttempts, 1001);
  });

  it('negative control: a reset counter starts over', () => {
    const almost = recordFailedAttempt(3, 5);
    assert.isFalse(almost.shouldWipe);
    const afterReset = recordFailedAttempt(resetFailedAttempts(), 5);
    assert.strictEqual(afterReset.failedAttempts, 1);
    assert.strictEqual(afterReset.remaining, 4);
    assert.isFalse(afterReset.shouldWipe);
  });

  it('still wipes when the stored count is already past the limit', () => {
    assert.isTrue(recordFailedAttempt(30, 20).shouldWipe);
    assert.strictEqual(recordFailedAttempt(-4, 5).failedAttempts, 1);
  });
});
