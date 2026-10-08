// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { ScryptParamsType } from '../../../wren/lock/keyWrap.node.ts';
import {
  createDuressVerifier,
  matchesDuress,
} from '../../../wren/lock/duressVerifier.node.ts';

const FAST: ScryptParamsType = {
  N: 2 ** 10,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

describe('wren/lock/duressVerifier', () => {
  it('matches the duress passphrase it was made from', () => {
    const duress = createDuressVerifier('let them have it', FAST);
    assert.isTrue(matchesDuress('let them have it', duress, FAST));
  });

  it('stores a salted sha256, never the passphrase', () => {
    const a = createDuressVerifier('let them have it', FAST);
    const b = createDuressVerifier('let them have it', FAST);
    assert.lengthOf(a.verifier, 64);
    assert.notStrictEqual(a.salt, b.salt);
    assert.notStrictEqual(a.verifier, b.verifier);
    assert.notInclude(JSON.stringify(a), 'let them have it');
  });

  it('negative control: other passphrases do not match', () => {
    const duress = createDuressVerifier('let them have it', FAST);
    assert.isTrue(matchesDuress('let them have it', duress, FAST));
    assert.isFalse(matchesDuress('let them have It', duress, FAST));
    assert.isFalse(matchesDuress('', duress, FAST));
  });

  it('negative control: a changed verifier does not match', () => {
    const duress = createDuressVerifier('let them have it', FAST);
    const last = duress.verifier.at(-1) === '0' ? '1' : '0';
    const changed = {
      ...duress,
      verifier: duress.verifier.slice(0, -1) + last,
    };
    assert.isTrue(matchesDuress('let them have it', duress, FAST));
    assert.isFalse(matchesDuress('let them have it', changed, FAST));
    assert.isFalse(
      matchesDuress(
        'let them have it',
        { ...duress, verifier: duress.verifier.slice(2) },
        FAST
      )
    );
    assert.isFalse(
      matchesDuress('let them have it', { ...duress, salt: 'nothex' }, FAST)
    );
  });
});
