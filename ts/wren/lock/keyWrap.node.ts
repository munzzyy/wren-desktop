// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

export type ScryptParamsType = Readonly<{
  N: number;
  r: number;
  p: number;
  maxmem: number;
}>;

export const SCRYPT_PARAMS: ScryptParamsType = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
};

const DERIVED_KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const CIPHER = 'aes-256-gcm';
const HEX = /^(?:[0-9a-f]{2})+$/;

export type WrappedKeyType = Readonly<{
  salt: string;
  nonce: string;
  wrappedKey: string;
}>;

export function isHex(value: unknown, byteLength?: number): value is string {
  if (typeof value !== 'string' || !HEX.test(value)) {
    return false;
  }
  return byteLength === undefined || value.length === byteLength * 2;
}

export function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  params: ScryptParamsType = SCRYPT_PARAMS
): Buffer<ArrayBuffer> {
  return scryptSync(passphrase.normalize('NFKC'), salt, DERIVED_KEY_LENGTH, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: params.maxmem,
  });
}

export function newSalt(): Buffer<ArrayBuffer> {
  return randomBytes(SALT_LENGTH);
}

export function wrapKey(
  dbKeyHex: string,
  passphrase: string,
  params: ScryptParamsType = SCRYPT_PARAMS
): WrappedKeyType {
  if (!isHex(dbKeyHex)) {
    throw new Error('wrapKey: database key must be hex');
  }

  const salt = newSalt();
  const nonce = randomBytes(NONCE_LENGTH);
  const kek = deriveKey(passphrase, salt, params);
  const plain = Buffer.from(dbKeyHex, 'hex');
  try {
    const cipher = createCipheriv(CIPHER, kek, nonce, {
      authTagLength: TAG_LENGTH,
    });
    const body = Buffer.concat([
      cipher.update(plain),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return {
      salt: salt.toString('hex'),
      nonce: nonce.toString('hex'),
      wrappedKey: body.toString('hex'),
    };
  } finally {
    kek.fill(0);
    plain.fill(0);
  }
}

export function unwrapKey(
  wrapped: WrappedKeyType,
  passphrase: string,
  params: ScryptParamsType = SCRYPT_PARAMS
): string | undefined {
  if (
    !isHex(wrapped.salt, SALT_LENGTH) ||
    !isHex(wrapped.nonce, NONCE_LENGTH) ||
    !isHex(wrapped.wrappedKey) ||
    wrapped.wrappedKey.length <= TAG_LENGTH * 2
  ) {
    return undefined;
  }

  const body = Buffer.from(wrapped.wrappedKey, 'hex');
  const ciphertext = body.subarray(0, body.length - TAG_LENGTH);
  const tag = body.subarray(body.length - TAG_LENGTH);
  const kek = deriveKey(passphrase, Buffer.from(wrapped.salt, 'hex'), params);
  try {
    const decipher = createDecipheriv(
      CIPHER,
      kek,
      Buffer.from(wrapped.nonce, 'hex'),
      { authTagLength: TAG_LENGTH }
    );
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const result = plain.toString('hex');
    plain.fill(0);
    return result;
  } catch {
    return undefined;
  } finally {
    kek.fill(0);
  }
}
