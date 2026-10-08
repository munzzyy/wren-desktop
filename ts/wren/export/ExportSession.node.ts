// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { constants as fsConstants, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

import { decryptAttachmentV2ToSink } from '../../AttachmentCrypto.node.ts';
import { isPathInside } from '../../util/isPathInside.node.ts';
import {
  EXPORT_FILE_NAMES,
  type ExportAttachment,
  type ExportChat,
  type ExportFormat,
  type ExportMessage,
} from './model.std.ts';
import { MEDIA_DIR, getExportFolderName } from './fileNames.std.ts';
import { createChatWriter, type ChatWriter } from './writers.std.ts';
import type { GetDateParts } from './time.std.ts';

const MAX_FOLDER_ATTEMPTS = 100;

export type ChatExportSessionOptions = Readonly<{
  parentDir: string;
  format: ExportFormat;
  chat: ExportChat;
  attachmentsDir: string;
  getDateParts?: GetDateParts;
}>;

export type WriteResult = Readonly<{
  copied: number;
  missing: number;
}>;

async function createUniqueFolder(
  parentDir: string,
  baseName: string
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_FOLDER_ATTEMPTS; attempt += 1) {
    const name = attempt === 1 ? baseName : `${baseName} (${attempt})`;
    const folderPath = join(parentDir, name);
    try {
      // oxlint-disable-next-line no-await-in-loop
      await mkdir(folderPath);
      return folderPath;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
    }
  }
  throw new Error('Could not find a free folder name for the export');
}

export class ChatExportSession {
  readonly folderPath: string;
  readonly filePath: string;

  readonly #attachmentsDir: string;
  readonly #file: FileHandle;
  readonly #writer: ChatWriter;
  #pending = '';
  #mediaDirCreated = false;
  #closed = false;

  private constructor({
    folderPath,
    filePath,
    attachmentsDir,
    file,
    format,
    getDateParts,
  }: Readonly<{
    folderPath: string;
    filePath: string;
    attachmentsDir: string;
    file: FileHandle;
    format: ExportFormat;
    getDateParts?: GetDateParts;
  }>) {
    this.folderPath = folderPath;
    this.filePath = filePath;
    this.#attachmentsDir = attachmentsDir;
    this.#file = file;
    this.#writer = createChatWriter(
      format,
      chunk => {
        this.#pending += chunk;
      },
      { getDateParts }
    );
  }

  static async create({
    parentDir,
    format,
    chat,
    attachmentsDir,
    getDateParts,
  }: ChatExportSessionOptions): Promise<ChatExportSession> {
    if (!isAbsolute(parentDir)) {
      throw new Error('Export folder must be an absolute path');
    }
    const parentStat = await stat(parentDir);
    if (!parentStat.isDirectory()) {
      throw new Error('Export folder is not a directory');
    }

    const folderPath = await createUniqueFolder(
      parentDir,
      getExportFolderName(chat.name, chat.exportedAt, getDateParts)
    );
    const filePath = join(folderPath, EXPORT_FILE_NAMES[format]);

    let file: FileHandle;
    try {
      file = await open(filePath, 'wx');
    } catch (error) {
      await rm(folderPath, { recursive: true, force: true });
      throw error;
    }

    const session = new ChatExportSession({
      folderPath,
      filePath,
      attachmentsDir,
      file,
      format,
      getDateParts,
    });
    session.#writer.writeHeader(chat);
    await session.#flush();
    return session;
  }

  async writeMessages(
    messages: ReadonlyArray<ExportMessage>
  ): Promise<WriteResult> {
    this.#assertOpen();
    let copied = 0;
    let missing = 0;
    for (const message of messages) {
      const attachments: Array<ExportAttachment> = [];
      for (const attachment of message.attachments) {
        // oxlint-disable-next-line no-await-in-loop
        const result = await this.#copyAttachment(message.id, attachment);
        if (result.status === 'exported') {
          copied += 1;
        } else if (result.status === 'missing') {
          missing += 1;
        }
        attachments.push(result);
      }
      this.#writer.writeMessage({ ...message, attachments });
    }
    await this.#flush();
    return { copied, missing };
  }

  async finish(): Promise<string> {
    this.#assertOpen();
    this.#writer.writeFooter();
    await this.#flush();
    this.#closed = true;
    await this.#file.close();
    return this.filePath;
  }

  async abort(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      await this.#file.close().catch(() => undefined);
    }
    await rm(this.folderPath, { recursive: true, force: true });
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error('Export session is already closed');
    }
  }

  async #flush(): Promise<void> {
    if (this.#pending.length === 0) {
      return;
    }
    const chunk = this.#pending;
    this.#pending = '';
    await this.#file.appendFile(chunk, 'utf8');
  }

  async #copyAttachment(
    messageId: string,
    attachment: ExportAttachment
  ): Promise<ExportAttachment> {
    const { source, ...exportable } = attachment;
    const markMissing = (): ExportAttachment => ({
      ...exportable,
      status: 'missing',
      mediaPath: undefined,
    });

    if (exportable.status !== 'exported') {
      return { ...exportable, mediaPath: undefined };
    }
    if (source == null || exportable.mediaPath == null) {
      return markMissing();
    }

    const mediaDir = join(this.folderPath, MEDIA_DIR);
    const targetPath = normalize(join(this.folderPath, exportable.mediaPath));
    const sourcePath = normalize(join(this.#attachmentsDir, source.path));
    if (
      !isPathInside(targetPath, mediaDir) ||
      !isPathInside(sourcePath, this.#attachmentsDir)
    ) {
      return markMissing();
    }

    try {
      if (!this.#mediaDirCreated) {
        await mkdir(mediaDir, { recursive: true });
        this.#mediaDirCreated = true;
      }

      if (source.version === 2) {
        if (source.localKey == null || source.size == null) {
          return markMissing();
        }
        await decryptAttachmentV2ToSink(
          {
            type: 'local',
            ciphertextPath: sourcePath,
            keysBase64: source.localKey,
            size: source.size,
            idForLogging: `wren-export(${messageId})`,
          },
          createWriteStream(targetPath, { flags: 'wx' })
        );
      } else {
        await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
      }
      return exportable;
    } catch {
      await rm(targetPath, { force: true }).catch(() => undefined);
      return markMissing();
    }
  }
}
