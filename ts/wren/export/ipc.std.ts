// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import type { ExportChat, ExportFormat, ExportMessage } from './model.std.ts';

export const EXPORT_CHANNELS = {
  begin: 'wren-export:begin',
  write: 'wren-export:write',
  finish: 'wren-export:finish',
  abort: 'wren-export:abort',
} as const;

export type BeginExportRequest = Readonly<{
  parentDir: string;
  format: ExportFormat;
  chat: ExportChat;
  // Required while the passphrase lock is on.
  passphrase?: string;
}>;

export type BeginExportResponse = Readonly<
  | { status: 'started'; exportId: string; folderPath: string }
  | { status: 'wrong-passphrase' }
>;

export type WriteExportRequest = Readonly<{
  exportId: string;
  messages: ReadonlyArray<ExportMessage>;
}>;

export type FinishExportResponse = Readonly<{
  filePath: string;
  folderPath: string;
}>;

export type ExportIdRequest = Readonly<{
  exportId: string;
}>;
