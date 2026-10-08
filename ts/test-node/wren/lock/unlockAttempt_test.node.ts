// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { ScryptParamsType } from '../../../wren/lock/keyWrap.node.ts';
import { unwrapKey, wrapKey } from '../../../wren/lock/keyWrap.node.ts';
import type { DuressVerifierType } from '../../../wren/lock/duressVerifier.node.ts';
import {
  createDecoyVerifier,
  createDuressVerifier,
  matchesDuress,
} from '../../../wren/lock/duressVerifier.node.ts';
import type { LockStateType } from '../../../wren/lock/lockState.std.ts';
import type { UnlockAttemptDepsType } from '../../../wren/lock/unlockAttempt.node.ts';
import { attemptUnlock } from '../../../wren/lock/unlockAttempt.node.ts';

const FAST: ScryptParamsType = {
  N: 2 ** 10,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

const KEY = 'ab'.repeat(32);
const PASS = 'correct horse battery';
const DURESS = 'let them have it';

function makeState(overrides: Partial<LockStateType> = {}): LockStateType {
  return {
    version: 1,
    ...wrapKey(KEY, PASS, FAST),
    wipeAfter: 0,
    failedAttempts: 0,
    autoLockMinutes: 0,
    lockOnSystemLock: false,
    ...overrides,
  };
}

type Recorder = Readonly<{
  events: Array<string>;
  writes: Array<number>;
  deps: UnlockAttemptDepsType;
}>;

function record(failWrites = false): Recorder {
  const events = new Array<string>();
  const writes = new Array<number>();
  return {
    events,
    writes,
    deps: {
      writeState: state => {
        events.push(`write:${state.failedAttempts}`);
        if (failWrites) {
          throw new Error('EROFS');
        }
        writes.push(state.failedAttempts);
      },
      unwrap: (state, passphrase) => {
        events.push('unwrap');
        return unwrapKey(state, passphrase, FAST);
      },
      matchesDuress: (passphrase: string, duress: DuressVerifierType) => {
        events.push('duress');
        return matchesDuress(passphrase, duress, FAST);
      },
    },
  };
}

describe('wren/lock/unlockAttempt', () => {
  it('saves the attempt before any derivation runs', () => {
    const { events, deps } = record();
    const result = attemptUnlock(
      makeState({ failedAttempts: 2 }),
      'nope',
      deps
    );
    assert.deepEqual(events, ['write:3', 'unwrap', 'duress']);
    assert.strictEqual(result.kind, 'wrong');
  });

  it('refuses the attempt when the count cannot be saved', () => {
    const control = record();
    attemptUnlock(makeState(), PASS, control.deps);
    assert.include(control.events, 'unwrap', 'negative control');

    const { events, deps } = record(true);
    const result = attemptUnlock(makeState(), PASS, deps);
    assert.strictEqual(result.kind, 'not-counted');
    assert.deepEqual(events, ['write:1']);
  });

  it('resets the count after the right passphrase', () => {
    const { writes, deps } = record();
    const result = attemptUnlock(makeState({ failedAttempts: 4 }), PASS, deps);
    assert.deepEqual(result, { kind: 'unlocked', key: KEY });
    assert.deepEqual(writes, [5, 0]);
  });

  it('wipes when the saved count reaches the limit', () => {
    const below = attemptUnlock(
      makeState({ wipeAfter: 5, failedAttempts: 3 }),
      'nope',
      record().deps
    );
    assert.strictEqual(below.kind, 'wrong');
    assert.isFalse(below.kind === 'wrong' && below.outcome.shouldWipe);

    const last = attemptUnlock(
      makeState({ wipeAfter: 5, failedAttempts: 4 }),
      'nope',
      record().deps
    );
    assert.isTrue(last.kind === 'wrong' && last.outcome.shouldWipe);
  });

  it('recognizes the duress passphrase', () => {
    const state = makeState({ duress: createDuressVerifier(DURESS, FAST) });
    assert.strictEqual(
      attemptUnlock(state, DURESS, record().deps).kind,
      'duress'
    );
    assert.strictEqual(
      attemptUnlock(state, PASS, record().deps).kind,
      'unlocked'
    );
  });

  it('runs the same derivations with and without a duress passphrase', () => {
    const withDuress = makeState({
      duress: createDuressVerifier(DURESS, FAST),
    });
    const without = makeState();
    const runs = [
      [withDuress, 'nope'],
      [without, 'nope'],
      [withDuress, PASS],
      [without, PASS],
    ] as const;
    const traces = runs.map(([state, passphrase]) => {
      const { events, deps } = record();
      attemptUnlock(state, passphrase, deps);
      return events.filter(event => !event.startsWith('write')).join(',');
    });
    assert.deepEqual(traces, [
      'unwrap,duress',
      'unwrap,duress',
      'unwrap,duress',
      'unwrap,duress',
    ]);
  });

  it('a decoy verifier never matches and looks like a real one', () => {
    const decoy = createDecoyVerifier();
    const real = createDuressVerifier(DURESS, FAST);
    assert.lengthOf(decoy.salt, real.salt.length);
    assert.lengthOf(decoy.verifier, real.verifier.length);
    assert.isFalse(matchesDuress(DURESS, decoy, FAST));
    assert.isFalse(matchesDuress('', decoy, FAST));
    assert.isTrue(matchesDuress(DURESS, real, FAST), 'negative control');
  });
});
