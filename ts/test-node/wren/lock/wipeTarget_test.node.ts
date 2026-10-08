// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WipeTargetEnvType } from '../../../wren/lock/wipeTarget.node.ts';
import {
  getWipeScope,
  overwriteAndRemove,
} from '../../../wren/lock/wipeTarget.node.ts';

const LOCKED = JSON.stringify({ wrenLock: { version: 1 } });

function env(
  files: Record<string, string>,
  devices: Record<string, number> = {}
): WipeTargetEnvType {
  return {
    homeDir: '/home/u',
    appDataDir: '/home/u/.config',
    readFile: path => {
      const content = files[path];
      if (content === undefined) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return content;
    },
    getDevice: path => devices[path] ?? 1,
  };
}

describe('wren/lock/wipeTarget', () => {
  describe('getWipeScope', () => {
    it('negative control: a normal Wren data folder goes whole', () => {
      assert.strictEqual(
        getWipeScope(
          '/home/u/.config/Wren',
          env({ '/home/u/.config/Wren/config.json': LOCKED })
        ),
        'whole-folder'
      );
    });

    it('refuses a folder whose config.json has no lock', () => {
      for (const content of [undefined, '{}', '{"key":"ab"}', 'not json']) {
        const files: Record<string, string> = {};
        if (content !== undefined) {
          files['/home/u/.config/Wren/config.json'] = content;
        }
        assert.strictEqual(
          getWipeScope('/home/u/.config/Wren', env(files)),
          'refuse',
          String(content)
        );
      }
    });

    it('refuses relative and empty paths', () => {
      assert.strictEqual(getWipeScope('', env({})), 'refuse');
      assert.strictEqual(
        getWipeScope('Wren', env({ 'Wren/config.json': LOCKED })),
        'refuse'
      );
    });

    it('never takes home, appData, their parents, root or a mount point whole', () => {
      const cases: ReadonlyArray<string> = [
        '/',
        '/home',
        '/home/u',
        '/home/u/.config',
      ];
      for (const dir of cases) {
        const files = { [join(dir, 'config.json')]: LOCKED };
        assert.strictEqual(getWipeScope(dir, env(files)), 'known-entries', dir);
      }
      assert.strictEqual(
        getWipeScope(
          '/media/usb',
          env({ '/media/usb/config.json': LOCKED }, { '/media/usb': 2 })
        ),
        'known-entries'
      );
    });
  });

  describe('overwriteAndRemove', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'wren-wipe-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('removes the file and ignores one that is already gone', () => {
      const path = join(dir, 'config.json');
      writeFileSync(path, LOCKED);
      assert.strictEqual(readFileSync(path, 'utf8'), LOCKED);
      overwriteAndRemove(path);
      assert.isFalse(existsSync(path));
      overwriteAndRemove(path);
    });

    it('throws for a path it cannot open', () => {
      const sub = join(dir, 'sub');
      mkdirSync(sub);
      assert.throws(() => overwriteAndRemove(sub));
    });
  });
});
