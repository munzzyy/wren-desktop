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
import { join, resolve } from 'node:path';

import type { WipeTargetEnvType } from '../../../wren/lock/wipeTarget.node.ts';
import {
  getWipeScope,
  overwriteAndRemove,
} from '../../../wren/lock/wipeTarget.node.ts';

const LOCKED = JSON.stringify({ wrenLock: { version: 1 } });

// getWipeScope resolves what it gets, so on Windows /home/u becomes D:\home\u
// and the fakes have to be keyed the same way.
const lockedAt = (dir: string): Record<string, string> => ({
  [join(resolve(dir), 'config.json')]: LOCKED,
});

function env(
  files: Record<string, string>,
  devices: Record<string, number> = {},
  { homeDir = '/home/u', appDataDir = '/home/u/.config' } = {}
): WipeTargetEnvType {
  return {
    homeDir,
    appDataDir,
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
          env(lockedAt('/home/u/.config/Wren'))
        ),
        'whole-folder'
      );
    });

    it('refuses a folder whose config.json has no lock', () => {
      for (const content of [undefined, '{}', '{"key":"ab"}', 'not json']) {
        const files: Record<string, string> = {};
        if (content !== undefined) {
          files[join(resolve('/home/u/.config/Wren'), 'config.json')] = content;
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
        assert.strictEqual(
          getWipeScope(dir, env(lockedAt(dir))),
          'known-entries',
          dir
        );
      }
      assert.strictEqual(
        getWipeScope(
          '/media/usb',
          env(lockedAt('/media/usb'), { [resolve('/media/usb')]: 2 })
        ),
        'known-entries'
      );
    });

    it('on Windows, keeps drive roots, shares and other-case home whole', function (this: Mocha.Context) {
      if (process.platform !== 'win32') {
        this.skip();
      }
      const winEnv = (files: Record<string, string>) =>
        env(
          files,
          {},
          {
            homeDir: 'C:\\Users\\U',
            appDataDir: 'C:\\Users\\U\\AppData\\Roaming',
          }
        );
      for (const dir of [
        'C:\\',
        'c:\\',
        '\\\\server\\share\\',
        'C:\\Users',
        'c:\\users\\u',
        'C:/Users/U/AppData/Roaming',
      ]) {
        assert.strictEqual(
          getWipeScope(dir, winEnv(lockedAt(dir))),
          'known-entries',
          dir
        );
      }
      assert.strictEqual(
        getWipeScope(
          'C:\\Users\\U\\AppData\\Roaming\\Wren',
          winEnv(lockedAt('C:\\Users\\U\\AppData\\Roaming\\Wren'))
        ),
        'whole-folder'
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
