// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ScryptParamsType } from './keyWrap.node.ts';
import { SCRYPT_PARAMS, deriveKey, isHex, newSalt } from './keyWrap.node.ts';

export type DuressVerifierType = Readonly<{
  salt: string;
  verifier: string;
}>;

function computeVerifier(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  params: ScryptParamsType
): Buffer<ArrayBuffer> {
  const derived = deriveKey(passphrase, salt, params);
  try {
    return createHash('sha256').update(derived).digest();
  } finally {
    derived.fill(0);
  }
}

export function createDuressVerifier(
  passphrase: string,
  params: ScryptParamsType = SCRYPT_PARAMS
): DuressVerifierType {
  const salt = newSalt();
  return {
    salt: salt.toString('hex'),
    verifier: computeVerifier(passphrase, salt, params).toString('hex'),
  };
}

// Random salt and random verifier: costs one scrypt to compare, never matches.
export function createDecoyVerifier(): DuressVerifierType {
  return {
    salt: newSalt().toString('hex'),
    verifier: randomBytes(32).toString('hex'),
  };
}

export function matchesDuress(
  passphrase: string,
  duress: DuressVerifierType,
  params: ScryptParamsType = SCRYPT_PARAMS
): boolean {
  if (!isHex(duress.salt) || !isHex(duress.verifier, 32)) {
    return false;
  }
  const expected = Buffer.from(duress.verifier, 'hex');
  const actual = computeVerifier(
    passphrase,
    Buffer.from(duress.salt, 'hex'),
    params
  );
  return timingSafeEqual(actual, expected);
}
