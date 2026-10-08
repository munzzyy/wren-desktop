// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import SQL from '@signalapp/sqlcipher';

import type { WritableDB } from '../../../sql/Interface.std.ts';
import {
  finishInterruptedRekey,
  rekeyDatabase,
} from '../../../sql/Server.node.ts';

const OLD_KEY = 'aa'.repeat(32);
const NEW_KEY = 'bb'.repeat(32);

function open(path: string, key: string): WritableDB {
  const db = new SQL(path) as WritableDB;
  try {
    db.pragma(`key = "x'${key}'"`);
    db.pragma('journal_mode = WAL');
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

function countRows(path: string, key: string): number {
  const db = open(path, key);
  try {
    return (
      db.prepare('SELECT count(*) AS n FROM t').get<{ n: number }>()?.n ?? -1
    );
  } finally {
    db.close();
  }
}

describe('wren/lock rekeyDatabase', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wren-rekey-'));
    path = join(dir, 'db.sqlite');
    const db = open(path, OLD_KEY);
    db.exec('CREATE TABLE t (v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES ($v)').run({ v: 'before' });
    db.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('negative control: the old key opens the database before the rekey', () => {
    assert.strictEqual(countRows(path, OLD_KEY), 1);
    assert.throws(() => countRows(path, NEW_KEY), /not a database/i);
  });

  it('after the rekey only the new key opens it, with every row', () => {
    const db = open(path, OLD_KEY);
    db.prepare('INSERT INTO t (v) VALUES ($v)').run({ v: 'in the wal' });
    rekeyDatabase(db, NEW_KEY);
    db.prepare('INSERT INTO t (v) VALUES ($v)').run({ v: 'after' });
    db.close();

    assert.throws(() => countRows(path, OLD_KEY), /not a database/i);
    assert.strictEqual(countRows(path, NEW_KEY), 3);
  });

  it('finishes a rekey that never ran, from the previous key', () => {
    finishInterruptedRekey(path, NEW_KEY, OLD_KEY);
    assert.throws(() => countRows(path, OLD_KEY), /not a database/i);
    assert.strictEqual(countRows(path, NEW_KEY), 1);
  });

  it('leaves a database that already has the new key alone', () => {
    const db = open(path, OLD_KEY);
    rekeyDatabase(db, NEW_KEY);
    db.close();
    finishInterruptedRekey(path, NEW_KEY, OLD_KEY);
    assert.strictEqual(countRows(path, NEW_KEY), 1);
  });

  it('refuses when neither key opens the database', () => {
    assert.throws(
      () => finishInterruptedRekey(path, NEW_KEY, 'cc'.repeat(32)),
      /neither/
    );
    assert.strictEqual(countRows(path, OLD_KEY), 1);
  });

  it('refuses a key that is not 32 bytes of hex', () => {
    const db = open(path, OLD_KEY);
    try {
      for (const bad of ['', 'ab', `${NEW_KEY}"; --`, 'zz'.repeat(32)]) {
        assert.throws(() => rekeyDatabase(db, bad), /32 bytes of hex/);
      }
    } finally {
      db.close();
    }
    assert.strictEqual(countRows(path, OLD_KEY), 1);
  });
});
