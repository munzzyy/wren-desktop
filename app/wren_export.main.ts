// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';

import { getAttachmentsPath } from './attachments.node.ts';
import { ChatExportSession } from '../ts/wren/export/ExportSession.node.ts';
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
import * as Errors from '../ts/types/errors.std.ts';

const log = createLogger('wren_export');

const sessions = new Map<string, ChatExportSession>();

function parseBeginRequest(payload: unknown): BeginExportRequest {
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

export function initialize({ configDir }: { configDir: string }): void {
  const attachmentsDir = getAttachmentsPath(configDir);

  ipcMain.handle(
    EXPORT_CHANNELS.begin,
    async (_event, payload: unknown): Promise<BeginExportResponse> => {
      const request = parseBeginRequest(payload);
      const session = await ChatExportSession.create({
        ...request,
        attachmentsDir,
      });
      const exportId = randomUUID();
      sessions.set(exportId, session);
      log.info(`begin: ${exportId} format=${request.format}`);
      return { exportId, folderPath: session.folderPath };
    }
  );

  ipcMain.handle(
    EXPORT_CHANNELS.write,
    async (_event, payload: unknown): Promise<WriteResult> => {
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
    async (_event, payload: unknown): Promise<FinishExportResponse> => {
      const [exportId, session] = getSession(payload);
      sessions.delete(exportId);
      try {
        const filePath = await session.finish();
        log.info(`finish: ${exportId}`);
        return { filePath, folderPath: session.folderPath };
      } catch (error) {
        log.error(`finish: ${exportId} failed`, Errors.toLogFormat(error));
        await session.abort();
        throw error;
      }
    }
  );

  ipcMain.handle(
    EXPORT_CHANNELS.abort,
    async (_event, payload: unknown): Promise<void> => {
      const exportId = (payload as Partial<ExportIdRequest> | undefined)
        ?.exportId;
      const session =
        typeof exportId === 'string' ? sessions.get(exportId) : undefined;
      if (exportId == null || session == null) {
        return;
      }
      sessions.delete(exportId);
      log.info(`abort: ${exportId}`);
      await session.abort();
    }
  );
}
