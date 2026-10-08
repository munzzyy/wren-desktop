// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from 'node:crypto';
import { assert } from 'chai';

import type { ScryptParamsType } from '../../../wren/lock/keyWrap.node.ts';
import {
  SCRYPT_PARAMS,
  deriveKey,
  unwrapKey,
  wrapKey,
} from '../../../wren/lock/keyWrap.node.ts';

const FAST: ScryptParamsType = {
  N: 2 ** 10,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

function flipHexDigit(hex: string, index: number): string {
  const digit = hex[index] === '0' ? '1' : '0';
  return hex.slice(0, index) + digit + hex.slice(index + 1);
}

describe('wren/lock/keyWrap', () => {
  const dbKey = randomBytes(32).toString('hex');

  it('round-trips the database key with the real scrypt parameters', () => {
    const wrapped = wrapKey(dbKey, 'correct horse battery staple');
    assert.strictEqual(
      unwrapKey(wrapped, 'correct horse battery staple'),
      dbKey
    );
  });

  it('uses N=2^17, r=8, p=1 by default', () => {
    assert.deepEqual(
      { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p },
      { N: 131072, r: 8, p: 1 }
    );
    assert.isAtLeast(SCRYPT_PARAMS.maxmem, 128 * SCRYPT_PARAMS.N * 8);
  });

  it('writes a fresh 16-byte salt and 12-byte nonce every time', () => {
    const a = wrapKey(dbKey, 'passphrase one', FAST);
    const b = wrapKey(dbKey, 'passphrase one', FAST);
    assert.lengthOf(a.salt, 32);
    assert.lengthOf(a.nonce, 24);
    assert.notStrictEqual(a.salt, b.salt);
    assert.notStrictEqual(a.nonce, b.nonce);
    assert.notStrictEqual(a.wrappedKey, b.wrappedKey);
    assert.notInclude(a.wrappedKey, dbKey);
  });

  it('negative control: a wrong passphrase does not unwrap', () => {
    const wrapped = wrapKey(dbKey, 'passphrase one', FAST);
    assert.strictEqual(unwrapKey(wrapped, 'passphrase one', FAST), dbKey);
    assert.isUndefined(unwrapKey(wrapped, 'passphrase two', FAST));
    assert.isUndefined(unwrapKey(wrapped, 'passphrase one ', FAST));
    assert.isUndefined(unwrapKey(wrapped, '', FAST));
  });

  it('negative control: tampering with any field fails closed', () => {
    const wrapped = wrapKey(dbKey, 'passphrase one', FAST);
    assert.isUndefined(
      unwrapKey(
        { ...wrapped, wrappedKey: flipHexDigit(wrapped.wrappedKey, 3) },
        'passphrase one',
        FAST
      )
    );
    assert.isUndefined(
      unwrapKey(
        { ...wrapped, nonce: flipHexDigit(wrapped.nonce, 0) },
        'passphrase one',
        FAST
      )
    );
    assert.isUndefined(
      unwrapKey(
        { ...wrapped, salt: flipHexDigit(wrapped.salt, 0) },
        'passphrase one',
        FAST
      )
    );
    assert.isUndefined(
      unwrapKey(
        { ...wrapped, wrappedKey: wrapped.wrappedKey.slice(0, 30) },
        'passphrase one',
        FAST
      )
    );
    assert.isUndefined(
      unwrapKey({ ...wrapped, salt: 'zz' }, 'passphrase one', FAST)
    );
  });

  it('treats Unicode forms of the same passphrase alike', () => {
    const wrapped = wrapKey(dbKey, 'café au lait', FAST);
    assert.strictEqual(unwrapKey(wrapped, 'café au lait', FAST), dbKey);
  });

  it('refuses a key that is not hex', () => {
    assert.throws(() => wrapKey('not hex', 'passphrase one', FAST));
  });

  it('derives 32 bytes deterministically for one salt', () => {
    const salt = randomBytes(16);
    const a = deriveKey('passphrase one', salt, FAST);
    const b = deriveKey('passphrase one', salt, FAST);
    assert.lengthOf(a, 32);
    assert.isTrue(a.equals(b));
    assert.isFalse(a.equals(deriveKey('passphrase two', salt, FAST)));
  });
});
