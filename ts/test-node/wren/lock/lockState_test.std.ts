// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import lodash from 'lodash';

import type { LockStateType } from '../../../wren/lock/lockState.std.ts';
import {
  getIdleSeconds,
  isWeakerLimit,
  parseLockState,
  serializeLockState,
  shouldAutoLock,
} from '../../../wren/lock/lockState.std.ts';
import { getPassphraseStrength } from '../../../wren/lock/passphraseStrength.std.ts';

const STATE: LockStateType = {
  version: 1,
  salt: '00112233445566778899aabbccddeeff',
  nonce: '00112233445566778899aabb',
  wrappedKey: 'ab'.repeat(48),
  duress: { salt: 'cd'.repeat(16), verifier: 'ef'.repeat(32) },
  wipeAfter: 10,
  failedAttempts: 2,
  autoLockMinutes: 15,
  lockOnSystemLock: true,
};

describe('wren/lock/lockState', () => {
  it('round-trips through JSON the way config.json stores it', () => {
    const stored = JSON.parse(JSON.stringify(serializeLockState(STATE)));
    assert.deepEqual(parseLockState(stored), STATE);
  });

  it('leaves duress out when it is not set', () => {
    const withoutDuress = lodash.omit(STATE, 'duress');
    const serialized = serializeLockState(withoutDuress);
    assert.notProperty(serialized, 'duress');
    assert.deepEqual(parseLockState(serialized), withoutDuress);
  });

  it('keeps the previous key during a rekey and rejects a damaged one', () => {
    const previous = {
      salt: '11'.repeat(16),
      nonce: '22'.repeat(12),
      wrappedKey: '33'.repeat(48),
    };
    const pending = { ...STATE, previous };
    const stored = JSON.parse(JSON.stringify(serializeLockState(pending)));
    assert.deepEqual(parseLockState(stored), pending);
    assert.notProperty(serializeLockState(STATE), 'previous');
    assert.isUndefined(
      parseLockState({ ...stored, previous: { ...previous, nonce: 'xyz' } })
    );
  });

  it('never serializes anything but the listed fields', () => {
    const serialized = serializeLockState({
      ...STATE,
      ...{ key: 'deadbeef' },
    });
    assert.notProperty(serialized, 'key');
    assert.sameMembers(Object.keys(serialized), [
      'version',
      'salt',
      'nonce',
      'wrappedKey',
      'duress',
      'wipeAfter',
      'failedAttempts',
      'autoLockMinutes',
      'lockOnSystemLock',
    ]);
  });

  it('falls back to safe defaults for bad optional settings', () => {
    const parsed = parseLockState({
      ...serializeLockState(STATE),
      wipeAfter: 7,
      failedAttempts: -1,
      autoLockMinutes: 'soon',
      lockOnSystemLock: 'yes',
    });
    assert.deepInclude(parsed, {
      wipeAfter: 0,
      failedAttempts: 0,
      autoLockMinutes: 0,
      lockOnSystemLock: false,
    });
  });

  it('negative control: rejects a damaged key record', () => {
    assert.isDefined(parseLockState(serializeLockState(STATE)));
    assert.isUndefined(parseLockState(undefined));
    assert.isUndefined(parseLockState('wrenLock'));
    assert.isUndefined(
      parseLockState({ ...serializeLockState(STATE), version: 2 })
    );
    assert.isUndefined(
      parseLockState({ ...serializeLockState(STATE), salt: 'xyz' })
    );
    assert.isUndefined(
      parseLockState({ ...serializeLockState(STATE), wrappedKey: 'abc' })
    );
    assert.isUndefined(
      parseLockState({
        ...serializeLockState(STATE),
        duress: { salt: 'cd'.repeat(16) },
      })
    );
  });
});

describe('wren/lock/passphraseStrength', () => {
  it('grades short, medium and long passphrases', () => {
    assert.strictEqual(getPassphraseStrength('hunter22'), 'weak');
    assert.strictEqual(getPassphraseStrength('purple-otter-9'), 'fair');
    assert.strictEqual(
      getPassphraseStrength('quiet river under old stone'),
      'strong'
    );
  });
});

describe('wren/lock isWeakerLimit', () => {
  it('negative control: tightening or keeping a limit is not weaker', () => {
    assert.isFalse(isWeakerLimit(0, 5));
    assert.isFalse(isWeakerLimit(20, 5));
    assert.isFalse(isWeakerLimit(10, 10));
  });

  it('turning a limit off or raising it is weaker', () => {
    assert.isTrue(isWeakerLimit(5, 0));
    assert.isTrue(isWeakerLimit(5, 10));
    assert.isTrue(isWeakerLimit(15, 60));
  });
});

describe('wren/lock auto-lock clock', () => {
  const NOW = 10_000_000;

  it('negative control: system idle alone still locks', () => {
    const idle = getIdleSeconds({
      systemIdleSeconds: 6 * 60,
      lastActivityMs: NOW,
      nowMs: NOW,
    });
    assert.isTrue(shouldAutoLock(5, idle));
  });

  it('locks on app idle when the system reports 0, as on Wayland', () => {
    const idle = getIdleSeconds({
      systemIdleSeconds: 0,
      lastActivityMs: NOW - 5 * 60 * 1000,
      nowMs: NOW,
    });
    assert.strictEqual(idle, 300);
    assert.isTrue(shouldAutoLock(5, idle));
    assert.isFalse(shouldAutoLock(15, idle));
  });

  it('recent input keeps it unlocked and off never locks', () => {
    const idle = getIdleSeconds({
      systemIdleSeconds: 0,
      lastActivityMs: NOW - 1000,
      nowMs: NOW,
    });
    assert.isFalse(shouldAutoLock(5, idle));
    assert.isFalse(shouldAutoLock(0, 1e9));
  });

  it('ignores a clock that went backwards and a bad system value', () => {
    assert.strictEqual(
      getIdleSeconds({
        systemIdleSeconds: Number.NaN,
        lastActivityMs: NOW + 60_000,
        nowMs: NOW,
      }),
      0
    );
  });
});
