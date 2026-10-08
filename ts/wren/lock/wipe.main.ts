// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from 'node:fs';
import { app } from 'electron';

import type { LoggerType } from '../../types/Logging.std.ts';
import { toLogFormat } from '../../types/errors.std.ts';

export type WipeReasonType = 'duress' | 'failed-attempts';

export type WipeOptionsType = Readonly<{
  userDataPath: string;
  reason: WipeReasonType;
  log: LoggerType;
  closeDatabase?: () => Promise<void>;
}>;

export async function wipeAndExit({
  userDataPath,
  reason,
  log,
  closeDatabase,
}: WipeOptionsType): Promise<void> {
  try {
    log.warn(`wren-lock: erasing all local data (${reason})`);
    await closeDatabase?.();
  } catch (error) {
    log.error('wren-lock: closing before the wipe failed', toLogFormat(error));
  }

  try {
    // Windows can hold log and cache files open for a moment after close.
    rmSync(userDataPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (error) {
    log.error('wren-lock: the wipe left files behind', toLogFormat(error));
  }

  app.exit(0);
}
