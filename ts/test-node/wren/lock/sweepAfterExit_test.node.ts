// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getSweepCommand,
  isSweepableDir,
} from '../../../wren/lock/sweepAfterExit.node.ts';

const HOSTILE = '/tmp/wren data\'; touch /tmp/owned; echo "$(id)" `id`';

describe('wren/lock/sweepAfterExit', () => {
  it('passes the folder to sh as an argument, not as script text', () => {
    const { command, args } = getSweepCommand({
      platform: 'linux',
      pid: 4242,
      dir: HOSTILE,
    });
    assert.strictEqual(command, '/bin/sh');
    assert.strictEqual(args[0], '-c');
    assert.notInclude(args[1], HOSTILE);
    assert.notInclude(args[1], '4242');
    assert.deepEqual(args.slice(2), ['wren-sweep', '4242', HOSTILE, '2']);
  });

  it('passes the folder to PowerShell through the environment', () => {
    const { command, args, env } = getSweepCommand({
      platform: 'win32',
      pid: 4242,
      dir: 'C:\\Users\\me\\AppData\\Roaming\\Wren',
      settleSeconds: 0,
    });
    assert.strictEqual(command, 'powershell.exe');
    assert.notInclude(args.join(' '), 'AppData');
    assert.deepEqual(env, {
      WREN_SWEEP_PID: '4242',
      WREN_SWEEP_DIR: 'C:\\Users\\me\\AppData\\Roaming\\Wren',
      WREN_SWEEP_SETTLE: '0',
    });
  });

  it('refuses empty, relative and root paths', () => {
    assert.isFalse(isSweepableDir(''));
    assert.isFalse(isSweepableDir('Wren'));
    assert.isFalse(isSweepableDir('/'));
    assert.isFalse(isSweepableDir('/tmp/..'));
    assert.isTrue(isSweepableDir('/tmp/Wren'));
  });

  if (process.platform !== 'win32') {
    it('waits for the process to exit, then erases what came back', async () => {
      const owned = `wren-sweep-owned-${process.pid}`;
      const canary = join(tmpdir(), owned);
      const dir = mkdtempSync(
        join(tmpdir(), `wren sweep '$(touch ${owned})' `)
      );
      try {
        writeFileSync(join(dir, 'config.json'), '{}');
        const owner = spawn('/bin/sh', ['-c', 'sleep 1']);
        const { command, args } = getSweepCommand({
          platform: process.platform,
          pid: owner.pid ?? -1,
          dir,
          settleSeconds: 0,
        });
        const sweeper = spawn(command, args, {
          cwd: tmpdir(),
          stdio: 'ignore',
        });

        await new Promise(resolve => setTimeout(resolve, 300));
        assert.isTrue(existsSync(dir), 'swept while the owner was running');
        writeFileSync(join(dir, 'Preferences'), '{}');

        await once(owner, 'exit');
        const [code] = await once(sweeper, 'exit');
        assert.strictEqual(code, 0);
        assert.isFalse(existsSync(dir));
        assert.isFalse(existsSync(canary));
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(canary, { force: true });
      }
    });
  }
});
