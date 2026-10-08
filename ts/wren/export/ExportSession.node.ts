// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from 'node:crypto';
import { constants as fsConstants, createWriteStream, rmSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { copyFile, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize } from 'node:path';

import { decryptAttachmentV2ToSink } from '../../AttachmentCrypto.node.ts';
import { isPathInside } from '../../util/isPathInside.node.ts';
import {
  EXPORT_FILE_NAMES,
  type ExportAttachment,
  type ExportChat,
  type ExportFormat,
  type ExportMessage,
} from './model.std.ts';
import {
  MEDIA_DIR,
  getExportFolderName,
  getMediaExtension,
} from './fileNames.std.ts';
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

const PARTIAL_SUFFIX = '.partial';
const PARTIAL_PREFIX = '.wren-export-';

export function isPartialExportName(name: string): boolean {
  return (
    name.startsWith(PARTIAL_PREFIX) &&
    name.endsWith(PARTIAL_SUFFIX) &&
    /^[0-9a-f]{16}$/.test(
      name.slice(PARTIAL_PREFIX.length, -PARTIAL_SUFFIX.length)
    )
  );
}

// The working folder has a random name, so a half-written export never shows
// up under the chat's name and the path Wren records says nothing about it.
async function createPartialFolder(parentDir: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_FOLDER_ATTEMPTS; attempt += 1) {
    const folderPath = join(
      parentDir,
      `${PARTIAL_PREFIX}${randomBytes(8).toString('hex')}${PARTIAL_SUFFIX}`
    );
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
  throw new Error('Could not create a working folder for the export');
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function moveToUniqueFolder(
  partialPath: string,
  parentDir: string,
  baseName: string
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_FOLDER_ATTEMPTS; attempt += 1) {
    const name = attempt === 1 ? baseName : `${baseName} (${attempt})`;
    const folderPath = join(parentDir, name);
    // oxlint-disable-next-line no-await-in-loop
    if (await exists(folderPath)) {
      continue;
    }
    try {
      // oxlint-disable-next-line no-await-in-loop
      await rename(partialPath, folderPath);
      return folderPath;
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) {
        throw error;
      }
    }
  }
  throw new Error('Could not find a free folder name for the export');
}

export class ChatExportSession {
  readonly partialPath: string;

  readonly #parentDir: string;
  readonly #baseName: string;
  readonly #fileName: string;
  readonly #attachmentsDir: string;
  readonly #file: FileHandle;
  readonly #writer: ChatWriter;
  #folderPath: string;
  #pending = '';
  #mediaDirCreated = false;
  #closed = false;

  private constructor({
    partialPath,
    parentDir,
    baseName,
    fileName,
    attachmentsDir,
    file,
    format,
    getDateParts,
  }: Readonly<{
    partialPath: string;
    parentDir: string;
    baseName: string;
    fileName: string;
    attachmentsDir: string;
    file: FileHandle;
    format: ExportFormat;
    getDateParts?: GetDateParts;
  }>) {
    this.partialPath = partialPath;
    this.#folderPath = partialPath;
    this.#parentDir = parentDir;
    this.#baseName = baseName;
    this.#fileName = fileName;
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

  // The working folder until finish() moves it to its real name.
  get folderPath(): string {
    return this.#folderPath;
  }

  get filePath(): string {
    return join(this.#folderPath, this.#fileName);
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

    const partialPath = await createPartialFolder(parentDir);
    const fileName = EXPORT_FILE_NAMES[format];

    let file: FileHandle;
    try {
      file = await open(join(partialPath, fileName), 'wx');
    } catch (error) {
      await rm(partialPath, { recursive: true, force: true });
      throw error;
    }

    const session = new ChatExportSession({
      partialPath,
      parentDir,
      baseName: getExportFolderName(chat.name, chat.exportedAt, getDateParts),
      fileName,
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
    this.#folderPath = await moveToUniqueFolder(
      this.partialPath,
      this.#parentDir,
      this.#baseName
    );
    return this.filePath;
  }

  async abort(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      await this.#file.close().catch(() => undefined);
    }
    await rm(this.partialPath, { recursive: true, force: true });
  }

  // For lock and quit, which can't wait. The handle closes with the process.
  abortNow(): void {
    this.#closed = true;
    rmSync(this.partialPath, { recursive: true, force: true });
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

    const mediaDir = join(this.partialPath, MEDIA_DIR);
    const targetPath = normalize(join(this.partialPath, exportable.mediaPath));
    const sourcePath = normalize(join(this.#attachmentsDir, source.path));
    if (
      !isPathInside(targetPath, mediaDir) ||
      !isPathInside(sourcePath, this.#attachmentsDir) ||
      extname(targetPath) !==
        `.${getMediaExtension(exportable.fileName, exportable.contentType)}`
    ) {
      return markMissing();
    }

    let sink: WriteStream | undefined;
    try {
      if (!this.#mediaDirCreated) {
        await mkdir(mediaDir, { recursive: true });
        this.#mediaDirCreated = true;
      }

      if (source.version === 2) {
        if (source.localKey == null || source.size == null) {
          return markMissing();
        }
        sink = createWriteStream(targetPath, { flags: 'wx' });
        await decryptAttachmentV2ToSink(
          {
            type: 'local',
            ciphertextPath: sourcePath,
            keysBase64: source.localKey,
            size: source.size,
            idForLogging: `wren-export(${messageId})`,
          },
          sink
        );
      } else {
        await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
      }
      return exportable;
    } catch {
      // Windows keeps the file open until the stream closes, so rm fails or races it.
      if (sink != null && !sink.closed) {
        const closed = new Promise<void>(resolve => {
          sink?.once('close', () => resolve());
        });
        sink.destroy();
        await closed;
      }
      await rm(targetPath, { force: true }).catch(() => undefined);
      return markMissing();
    }
  }
}
