// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import {
  closeSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';

import { LOCK_STATE_CONFIG_KEY } from './lockState.std.ts';

// Most sensitive first: the wrapped key, then the database, then the rest.
export const KEY_FILES = ['config.json', 'ephemeral.json'] as const;
export const DATABASE_DIR = 'sql';
export const KNOWN_ENTRIES = [
  'attachments.noindex',
  'avatars.noindex',
  'badges.noindex',
  'downloads.noindex',
  'drafts.noindex',
  'megaphones.noindex',
  'stickers.noindex',
  'IndexedDB',
  'Local Storage',
  'Session Storage',
  'WebStorage',
  'blob_storage',
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Shared Dictionary',
  'SharedStorage',
  'Crashpad',
  'crashes',
  'logs',
  'temp',
  'optionalResources',
  'update-cache',
  'Cookies',
  'Cookies-journal',
  'Network Persistent State',
  'Preferences',
  'TransportSecurity',
  'Trust Tokens',
  'Trust Tokens-journal',
  'DIPS',
  'Dictionaries',
  'Local State',
] as const;

export type WipeScopeType = 'refuse' | 'known-entries' | 'whole-folder';

export type WipeTargetEnvType = Readonly<{
  homeDir: string;
  appDataDir: string;
  readFile?: (path: string) => string;
  getDevice?: (path: string) => number | bigint;
}>;

function isSameOrInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function holdsWrenLock(dir: string, readFile: (path: string) => string) {
  try {
    const config: unknown = JSON.parse(readFile(join(dir, 'config.json')));
    return (
      typeof config === 'object' &&
      config != null &&
      LOCK_STATE_CONFIG_KEY in config
    );
  } catch {
    return false;
  }
}

// Nothing is deleted unless config.json there holds a Wren lock. The folder
// itself only goes when it can't be the home folder, the appData root, a
// parent of either, the filesystem root or a mount point; otherwise only the
// entries Wren and Electron create are removed.
export function getWipeScope(
  dir: string,
  {
    homeDir,
    appDataDir,
    readFile = path => readFileSync(path, 'utf8'),
    getDevice = path => statSync(path).dev,
  }: WipeTargetEnvType
): WipeScopeType {
  if (!dir || !isAbsolute(dir)) {
    return 'refuse';
  }
  const resolved = resolve(dir);
  if (!holdsWrenLock(resolved, readFile)) {
    return 'refuse';
  }
  if (
    resolved === parse(resolved).root ||
    isSameOrInside(resolve(homeDir), resolved) ||
    isSameOrInside(resolve(appDataDir), resolved)
  ) {
    return 'known-entries';
  }
  try {
    if (getDevice(resolved) !== getDevice(dirname(resolved))) {
      return 'known-entries';
    }
  } catch {
    return 'known-entries';
  }
  return 'whole-folder';
}

export function overwriteAndRemove(path: string): void {
  let fd: number;
  try {
    fd = openSync(path, 'r+');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  try {
    const { size } = fstatSync(fd);
    const zeros = Buffer.alloc(Math.min(size, 64 * 1024));
    for (let offset = 0; offset < size; offset += zeros.length) {
      writeSync(fd, zeros, 0, Math.min(zeros.length, size - offset), offset);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  unlinkSync(path);
}

export function fsyncDirectory(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    // Windows can't open or fsync a directory; the unlink still happened.
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

export function removeEntry(dir: string, name: string): void {
  rmSync(join(dir, name), {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
