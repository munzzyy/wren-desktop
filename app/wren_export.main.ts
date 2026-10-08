// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { dialog, ipcMain } from 'electron';

import { getAttachmentsPath } from './attachments.node.ts';
import {
  ChatExportSession,
  isPartialExportName,
} from '../ts/wren/export/ExportSession.node.ts';
import {
  EXPORT_CHANNELS,
  type BeginExportRequest,
  type BeginExportResponse,
  type ExportIdRequest,
  type FinishExportResponse,
  type WriteExportRequest,
} from '../ts/wren/export/ipc.std.ts';
import { isExportFormat } from '../ts/wren/export/model.std.ts';
import type { WriteResult } from '../ts/wren/export/ExportSession.node.ts';
import { createLogger } from '../ts/logging/log.std.ts';
import type { LocalizerType } from '../ts/types/I18N.std.ts';
import * as Errors from '../ts/types/errors.std.ts';

const log = createLogger('wren_export');

// Working folders of exports that are still running, so a crash or a kill
// in the middle can be cleaned up on the next start.
const PARTIALS_CONFIG_KEY = 'wrenExportPartials';

export type ExportConfigType = Readonly<{
  get: (keyPath: string) => unknown;
  set: (keyPath: string, value: unknown) => void;
}>;

const sessions = new Map<string, ChatExportSession>();
let exportConfig: ExportConfigType | undefined;

function isPartialPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isAbsolute(value) &&
    isPartialExportName(basename(value))
  );
}

function readPartials(): Array<string> {
  const value = exportConfig?.get(PARTIALS_CONFIG_KEY);
  return Array.isArray(value) ? value.filter(isPartialPath) : [];
}

function writePartials(paths: ReadonlyArray<string>): void {
  try {
    exportConfig?.set(
      PARTIALS_CONFIG_KEY,
      paths.length > 0 ? [...paths] : undefined
    );
  } catch (error) {
    log.warn('could not record the export folders', Errors.toLogFormat(error));
  }
}

function parseBeginRequest(
  payload: unknown
): Omit<BeginExportRequest, 'passphrase'> {
  const request = payload as Partial<BeginExportRequest> | undefined;
  const chat = request?.chat;
  if (
    typeof request?.parentDir !== 'string' ||
    !isExportFormat(request.format) ||
    chat == null ||
    typeof chat.id !== 'string' ||
    typeof chat.name !== 'string' ||
    (chat.type !== 'direct' && chat.type !== 'group') ||
    typeof chat.exportedAt !== 'number' ||
    typeof chat.includesMedia !== 'boolean'
  ) {
    throw new Error('Invalid export request');
  }
  return {
    parentDir: request.parentDir,
    format: request.format,
    chat: {
      id: chat.id,
      name: chat.name,
      type: chat.type,
      exportedAt: chat.exportedAt,
      includesMedia: chat.includesMedia,
    },
  };
}

function getSession(payload: unknown): [string, ChatExportSession] {
  const exportId = (payload as Partial<ExportIdRequest> | undefined)?.exportId;
  const session = typeof exportId === 'string' ? sessions.get(exportId) : null;
  if (exportId == null || session == null) {
    throw new Error('Unknown export');
  }
  return [exportId, session];
}

function forget(exportId: string, session: ChatExportSession): void {
  sessions.delete(exportId);
  writePartials(readPartials().filter(path => path !== session.partialPath));
}

// Lock, system lock and quit can't wait for the renderer, so every running
// export loses its half-written folder right here.
export function abortAll(): void {
  for (const [exportId, session] of sessions) {
    sessions.delete(exportId);
    try {
      session.abortNow();
      writePartials(
        readPartials().filter(path => path !== session.partialPath)
      );
    } catch (error) {
      log.warn('abortAll: a folder stayed behind', Errors.toLogFormat(error));
    }
  }
}

export async function offerToDeleteLeftovers({
  i18n,
  getMainWindow,
}: Readonly<{
  i18n: LocalizerType;
  getMainWindow: () => BrowserWindow | undefined;
}>): Promise<void> {
  const running = new Set(
    Array.from(sessions.values(), session => session.partialPath)
  );
  const leftovers = readPartials().filter(path => !running.has(path));
  const present = leftovers.filter(path => existsSync(path));
  if (present.length === 0) {
    if (leftovers.length > 0) {
      writePartials([]);
    }
    return;
  }

  const options = {
    type: 'warning' as const,
    message: i18n('icu:ExportChatLeftovers__title'),
    detail: i18n('icu:ExportChatLeftovers__detail', {
      paths: present.join('\n'),
    }),
    buttons: [
      i18n('icu:ExportChatLeftovers__delete'),
      i18n('icu:ExportChatLeftovers__keep'),
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const window = getMainWindow();
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);

  const kept = new Array<string>();
  if (response === 0) {
    for (const path of present) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch (error) {
        kept.push(path);
        log.warn(
          'could not delete a leftover export',
          Errors.toLogFormat(error)
        );
      }
    }
  }
  writePartials(kept);
}

export function initialize({
  configDir,
  config,
  isMainWindowSender,
  checkPassphrase,
}: {
  configDir: string;
  config: ExportConfigType;
  isMainWindowSender: (sender: WebContents) => boolean;
  checkPassphrase: (passphrase: unknown) => 'not-enabled' | 'ok' | 'wrong';
}): void {
  const attachmentsDir = getAttachmentsPath(configDir);
  exportConfig = config;

  const assertFromMainWindow = (event: IpcMainInvokeEvent): void => {
    const frame = event.senderFrame;
    if (
      !isMainWindowSender(event.sender) ||
      frame == null ||
      frame.parent != null
    ) {
      throw new Error('wren-export: request from an unknown sender');
    }
  };

  ipcMain.handle(
    EXPORT_CHANNELS.begin,
    async (event, payload: unknown): Promise<BeginExportResponse> => {
      assertFromMainWindow(event);
      // A chat leaves the encrypted database here, so with the lock on it
      // takes the passphrase, same as turning the lock off would.
      const passphrase = (payload as Partial<BeginExportRequest> | undefined)
        ?.passphrase;
      if (checkPassphrase(passphrase) === 'wrong') {
        log.warn('begin: wrong passphrase');
        return { status: 'wrong-passphrase' };
      }
      const request = parseBeginRequest(payload);
      const session = await ChatExportSession.create({
        ...request,
        attachmentsDir,
      });
      const exportId = randomUUID();
      sessions.set(exportId, session);
      writePartials([...readPartials(), session.partialPath]);
      log.info(`begin: ${exportId} format=${request.format}`);
      return { status: 'started', exportId, folderPath: session.folderPath };
    }
  );

  ipcMain.handle(
    EXPORT_CHANNELS.write,
    async (event, payload: unknown): Promise<WriteResult> => {
      assertFromMainWindow(event);
      const [, session] = getSession(payload);
      const { messages } = payload as WriteExportRequest;
      if (!Array.isArray(messages)) {
        throw new Error('Invalid export page');
      }
      return session.writeMessages(messages);
    }
  );

  ipcMain.handle(
    EXPORT_CHANNELS.finish,
    async (event, payload: unknown): Promise<FinishExportResponse> => {
      assertFromMainWindow(event);
      const [exportId, session] = getSession(payload);
      try {
        const filePath = await session.finish();
        forget(exportId, session);
        log.info(`finish: ${exportId}`);
        return { filePath, folderPath: session.folderPath };
      } catch (error) {
        log.error(`finish: ${exportId} failed`, Errors.toLogFormat(error));
        sessions.delete(exportId);
        await session.abort();
        forget(exportId, session);
        throw error;
      }
    }
  );

  ipcMain.handle(
    EXPORT_CHANNELS.abort,
    async (event, payload: unknown): Promise<void> => {
      assertFromMainWindow(event);
      const exportId = (payload as Partial<ExportIdRequest> | undefined)
        ?.exportId;
      const session =
        typeof exportId === 'string' ? sessions.get(exportId) : undefined;
      if (exportId == null || session == null) {
        return;
      }
      log.info(`abort: ${exportId}`);
      await session.abort();
      forget(exportId, session);
    }
  );
}
