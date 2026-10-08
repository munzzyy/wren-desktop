// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { app } from 'electron';

import type { LoggerType } from '../../types/Logging.std.ts';
import { toLogFormat } from '../../types/errors.std.ts';
import { sweepAfterExit } from './sweepAfterExit.node.ts';
import {
  DATABASE_DIR,
  KEY_FILES,
  KNOWN_ENTRIES,
  fsyncDirectory,
  getWipeScope,
  overwriteAndRemove,
  removeEntry,
} from './wipeTarget.node.ts';

export type WipeOptionsType = Readonly<{
  userDataPath: string;
  log: LoggerType;
  beforeWipe?: () => Promise<void>;
}>;

function attempt(log: LoggerType, what: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    log.error(`wren-lock: wipe step failed (${what})`, toLogFormat(error));
  }
}

export async function wipeAndExit({
  userDataPath,
  log,
  beforeWipe,
}: WipeOptionsType): Promise<void> {
  const scope = getWipeScope(userDataPath, {
    homeDir: homedir(),
    appDataDir: app.getPath('appData'),
  });
  if (scope === 'refuse') {
    log.error('wren-lock: refusing to erase a folder that is not Wren data');
    app.exit(0);
    return;
  }

  log.warn('wren-lock: erasing all local data');
  try {
    await beforeWipe?.();
  } catch (error) {
    log.error('wren-lock: closing before the wipe failed', toLogFormat(error));
  }

  const dir = resolve(userDataPath);
  for (const name of KEY_FILES) {
    attempt(log, name, () => overwriteAndRemove(resolve(dir, name)));
  }
  fsyncDirectory(dir);
  attempt(log, DATABASE_DIR, () => removeEntry(dir, DATABASE_DIR));
  for (const name of KNOWN_ENTRIES) {
    attempt(log, name, () => removeEntry(dir, name));
  }

  if (scope === 'whole-folder') {
    attempt(log, 'sweep', () => {
      if (!sweepAfterExit(dir)) {
        throw new Error('unsafe sweep path');
      }
    });
    // Windows can hold log and cache files open for a moment after close.
    attempt(log, 'folder', () =>
      rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      })
    );
  }

  app.exit(0);
}
