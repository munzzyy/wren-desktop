// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcRenderer } from 'electron';

import { DataReader } from '../../sql/Client.preload.ts';
import { isNormalBubble } from '../../state/selectors/message.preload.ts';
import { getNotificationDataForMessage } from '../../util/getNotificationDataForMessage.preload.ts';
import { isVoiceMessage } from '../../util/Attachment.std.ts';
import { isGroup } from '../../util/whatTypeOfConversation.dom.ts';
import { strictAssert } from '../../util/assert.std.ts';
import { createLogger } from '../../logging/log.std.ts';
import * as Errors from '../../types/errors.std.ts';
import type { LocalizerType } from '../../types/I18N.std.ts';
import { mapMessageToExport, type MapperContext } from './mapper.std.ts';
import { lockSettingsApi } from '../lock/settingsIpc.preload.ts';
import type { ExportChat, ExportFormat } from './model.std.ts';
import {
  EXPORT_CHANNELS,
  type BeginExportRequest,
  type BeginExportResponse,
  type FinishExportResponse,
  type WriteExportRequest,
} from './ipc.std.ts';

const log = createLogger('runChatExport');

const PAGE_SIZE = 200;

export type ChatExportProgress = Readonly<{
  processed: number;
  total: number;
}>;

export type ChatExportResult =
  | Readonly<{ status: 'done'; filePath: string; folderPath: string }>
  | Readonly<{ status: 'canceled' }>
  | Readonly<{ status: 'wrong-passphrase' }>;

export type RunChatExportOptions = Readonly<{
  conversationId: string;
  format: ExportFormat;
  includeMedia: boolean;
  passphrase?: string;
  onProgress: (progress: ChatExportProgress) => void;
  signal: AbortSignal;
}>;

export async function isExportPassphraseRequired(): Promise<boolean> {
  const status = await lockSettingsApi.getStatus();
  return status.enabled;
}

async function chooseExportFolder(
  i18n: LocalizerType
): Promise<string | undefined> {
  const { canceled, dirPath } = await ipcRenderer.invoke(
    'show-open-folder-dialog',
    {
      useMainWindow: true,
      title: i18n('icu:ExportChatDialog__folder-title'),
      buttonLabel: i18n('icu:ExportChatDialog__folder-button'),
    }
  );
  if (canceled || typeof dirPath !== 'string') {
    return undefined;
  }
  return dirPath;
}

function getTitleById(id: string): string | undefined {
  return window.ConversationController.get(id)?.getTitle();
}

function createMapperContext(includeMedia: boolean): MapperContext {
  return {
    includeMedia,
    ourName:
      window.ConversationController.getOurConversation()?.getTitle() ?? 'You',
    getNameByConversationId: getTitleById,
    getNameByServiceIdOrE164: getTitleById,
    isSystemMessage: message => !isNormalBubble(message),
    describeMessage: message => {
      try {
        return getNotificationDataForMessage(message).text;
      } catch (error) {
        log.warn('describeMessage failed', Errors.toLogFormat(error));
        return '';
      }
    },
    isVoiceMessage,
  };
}

export async function runChatExport({
  conversationId,
  format,
  includeMedia,
  passphrase,
  onProgress,
  signal,
}: RunChatExportOptions): Promise<ChatExportResult> {
  const conversation = window.ConversationController.get(conversationId);
  strictAssert(conversation, 'runChatExport: conversation not found');

  const parentDir = await chooseExportFolder(window.SignalContext.i18n);
  if (parentDir == null || signal.aborted) {
    return { status: 'canceled' };
  }

  const isGroupChat = isGroup(conversation.attributes);
  const chat: ExportChat = {
    id: conversationId,
    name: conversation.getTitle(),
    type: isGroupChat ? 'group' : 'direct',
    exportedAt: Date.now(),
    includesMedia: includeMedia,
  };
  const context = createMapperContext(includeMedia);
  const total = await DataReader.getMessageCount(conversationId);
  onProgress({ processed: 0, total });

  const beginRequest: BeginExportRequest = {
    parentDir,
    format,
    chat,
    passphrase,
  };
  const begun: BeginExportResponse = await ipcRenderer.invoke(
    EXPORT_CHANNELS.begin,
    beginRequest
  );
  if (begun.status === 'wrong-passphrase') {
    return { status: 'wrong-passphrase' };
  }
  const { exportId } = begun;

  const abort = async (): Promise<void> => {
    try {
      await ipcRenderer.invoke(EXPORT_CHANNELS.abort, { exportId });
    } catch (error) {
      log.warn('abort failed', Errors.toLogFormat(error));
    }
  };

  try {
    let processed = 0;
    let receivedAt = 0;
    let sentAt = 0;
    while (!signal.aborted) {
      // oxlint-disable-next-line no-await-in-loop
      const page = await DataReader.getNewerMessagesByConversation({
        conversationId,
        includeStoryReplies: !isGroupChat,
        limit: PAGE_SIZE,
        receivedAt,
        sentAt,
        storyId: undefined,
      });
      const last = page.at(-1);
      if (last == null) {
        break;
      }

      const messages = page
        .map(message => mapMessageToExport(message, context))
        .filter(message => message.kind !== 'system' || message.body !== '');
      const writeRequest: WriteExportRequest = { exportId, messages };
      // oxlint-disable-next-line no-await-in-loop
      await ipcRenderer.invoke(EXPORT_CHANNELS.write, writeRequest);

      processed += page.length;
      onProgress({ processed, total: Math.max(total, processed) });
      receivedAt = last.received_at;
      sentAt = last.sent_at;
      if (page.length < PAGE_SIZE) {
        break;
      }
    }

    if (signal.aborted) {
      await abort();
      return { status: 'canceled' };
    }

    const { filePath, folderPath }: FinishExportResponse =
      await ipcRenderer.invoke(EXPORT_CHANNELS.finish, { exportId });
    log.info(`exported ${processed} messages`);
    return { status: 'done', filePath, folderPath };
  } catch (error) {
    log.error('export failed', Errors.toLogFormat(error));
    await abort();
    throw error;
  }
}
