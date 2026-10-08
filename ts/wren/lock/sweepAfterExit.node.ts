// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from 'node:child_process';
import { isAbsolute, parse, resolve } from 'node:path';

export type SweepCommandType = Readonly<{
  command: string;
  args: ReadonlyArray<string>;
  env: Readonly<Record<string, string>>;
}>;

export type SweepOptionsType = Readonly<{
  platform: NodeJS.Platform;
  pid: number;
  dir: string;
  settleSeconds?: number;
}>;

const WAIT_FOR_EXIT_SECONDS = 30;
const DEFAULT_SETTLE_SECONDS = 2;

const POSIX_SCRIPT = [
  'pid=$1; dir=$2; settle=$3; n=0',
  '[ -n "$dir" ] || exit 0',
  `while kill -0 "$pid" 2>/dev/null && [ "$n" -lt ${WAIT_FOR_EXIT_SECONDS} ]; do sleep 1; n=$((n+1)); done`,
  'sleep "$settle"; rm -rf -- "$dir"',
  'sleep "$settle"; rm -rf -- "$dir"',
].join('\n');

const WINDOWS_SCRIPT = [
  `Wait-Process -Id $env:WREN_SWEEP_PID -Timeout ${WAIT_FOR_EXIT_SECONDS} -ErrorAction SilentlyContinue`,
  'foreach ($i in 1..2) {',
  '  Start-Sleep -Seconds $env:WREN_SWEEP_SETTLE',
  '  Remove-Item -LiteralPath $env:WREN_SWEEP_DIR -Recurse -Force -ErrorAction SilentlyContinue',
  '}',
].join('\n');

export function isSweepableDir(dir: string): boolean {
  if (!dir || !isAbsolute(dir)) {
    return false;
  }
  const resolved = resolve(dir);
  return resolved !== parse(resolved).root;
}

// The path and pid travel as arguments or environment, never inside the script text.
export function getSweepCommand({
  platform,
  pid,
  dir,
  settleSeconds = DEFAULT_SETTLE_SECONDS,
}: SweepOptionsType): SweepCommandType {
  const settle = String(Math.max(0, Math.floor(settleSeconds)));
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        WINDOWS_SCRIPT,
      ],
      env: {
        WREN_SWEEP_PID: String(pid),
        WREN_SWEEP_DIR: dir,
        WREN_SWEEP_SETTLE: settle,
      },
    };
  }
  return {
    command: '/bin/sh',
    args: ['-c', POSIX_SCRIPT, 'wren-sweep', String(pid), dir, settle],
    env: {},
  };
}

// Chromium rewrites a few files into userData while it shuts down.
export function sweepAfterExit(
  dir: string,
  settleSeconds = DEFAULT_SETTLE_SECONDS
): boolean {
  if (!isSweepableDir(dir)) {
    return false;
  }
  const { command, args, env } = getSweepCommand({
    platform: process.platform,
    pid: process.pid,
    dir: resolve(dir),
    settleSeconds,
  });
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  child.on('error', () => undefined);
  child.unref();
  return true;
}
