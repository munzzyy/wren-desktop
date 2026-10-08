// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeNewAttachmentData } from '../../../../app/attachments.node.ts';
import {
  ChatExportSession,
  isPartialExportName,
} from '../../../wren/export/ExportSession.node.ts';
import type {
  ExportAttachment,
  ExportMessage,
} from '../../../wren/export/model.std.ts';
import { getUtcDateParts } from '../../../wren/export/time.std.ts';
import { FIXTURE_CHAT, at } from './fixture.std.ts';

function imageAttachment(
  index: number,
  source: ExportAttachment['source']
): ExportAttachment {
  return {
    contentType: 'image/png',
    size: source?.size ?? 0,
    fileName: `pic${index}.png`,
    isVoiceNote: false,
    isSticker: false,
    status: 'exported',
    mediaPath: `media/m1-${index}.png`,
    source,
  };
}

function message(attachments: ReadonlyArray<ExportAttachment>): ExportMessage {
  return {
    id: 'm1',
    kind: 'message',
    sentAt: at(1),
    receivedAt: at(1),
    authorName: 'Alice',
    isOutgoing: false,
    body: 'pictures',
    isDeleted: false,
    isViewOnce: false,
    isEdited: false,
    reactions: [],
    attachments,
    links: [],
  };
}

describe('wren/export/ExportSession', () => {
  let root: string;
  let attachmentsDir: string;
  let outputDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wren-export-test-'));
    attachmentsDir = join(root, 'attachments.noindex');
    outputDir = join(root, 'out');
    await mkdir(attachmentsDir);
    await mkdir(outputDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('decrypts attachments into media/ and marks missing ones', async () => {
    const plaintext = new Uint8Array(Buffer.from('not really a png'));
    const encrypted = await writeNewAttachmentData({
      data: plaintext,
      getAbsoluteAttachmentPath: relative => join(attachmentsDir, relative),
    });
    const ciphertext = await readFile(join(attachmentsDir, encrypted.path));
    assert.notDeepEqual(
      new Uint8Array(ciphertext),
      plaintext,
      'negative control: the stored copy is encrypted'
    );

    await mkdir(join(attachmentsDir, 'v1'));
    await writeFile(join(attachmentsDir, 'v1', 'plain'), 'legacy bytes');

    const session = await ChatExportSession.create({
      parentDir: outputDir,
      format: 'text',
      chat: FIXTURE_CHAT,
      attachmentsDir,
      getDateParts: getUtcDateParts,
    });
    const result = await session.writeMessages([
      message([
        imageAttachment(1, {
          path: encrypted.path,
          version: 2,
          localKey: encrypted.localKey,
          size: encrypted.size,
        }),
        imageAttachment(2, { path: 'v1/plain', size: 12 }),
        imageAttachment(3, {
          path: 'gone/file',
          version: 2,
          localKey: 'AAAA',
          size: 3,
        }),
        imageAttachment(4, { path: '../../../etc/passwd', size: 3 }),
      ]),
    ]);
    const filePath = await session.finish();

    assert.deepEqual(result, { copied: 2, missing: 2 });
    assert.strictEqual(
      session.folderPath,
      join(outputDir, 'Book Club 2026-10-08 1500')
    );
    assert.strictEqual(filePath, join(session.folderPath, 'chat.txt'));

    const media = join(session.folderPath, 'media');
    assert.deepEqual((await readdir(media)).sort(), ['m1-1.png', 'm1-2.png']);
    assert.deepEqual(
      new Uint8Array(await readFile(join(media, 'm1-1.png'))),
      plaintext
    );
    assert.strictEqual(
      await readFile(join(media, 'm1-2.png'), 'utf8'),
      'legacy bytes'
    );

    const text = await readFile(filePath, 'utf8');
    assert.include(text, '[image] pic1.png (16 B) -> media/m1-1.png');
    assert.include(text, '[image] pic3.png (3 B) (not on this device)');
    assert.include(text, '[image] pic4.png (3 B) (not on this device)');
  });

  it('never writes outside the export folder', async () => {
    const session = await ChatExportSession.create({
      parentDir: outputDir,
      format: 'json',
      chat: FIXTURE_CHAT,
      attachmentsDir,
      getDateParts: getUtcDateParts,
    });
    await writeFile(join(attachmentsDir, 'x'), 'x');
    const result = await session.writeMessages([
      message([
        {
          ...imageAttachment(1, { path: 'x', size: 1 }),
          mediaPath: 'media/../../escape.png',
        },
      ]),
    ]);
    await session.finish();
    assert.deepEqual(result, { copied: 0, missing: 1 });
    assert.deepEqual(await readdir(outputDir), ['Book Club 2026-10-08 1500']);
  });

  it('picks a new folder name instead of reusing an existing one', async () => {
    await mkdir(join(outputDir, 'Book Club 2026-10-08 1500'));
    const session = await ChatExportSession.create({
      parentDir: outputDir,
      format: 'html',
      chat: FIXTURE_CHAT,
      attachmentsDir,
      getDateParts: getUtcDateParts,
    });
    await session.finish();
    assert.strictEqual(
      session.folderPath,
      join(outputDir, 'Book Club 2026-10-08 1500 (2)')
    );
  });

  it('writes into a hidden .partial folder until it finishes', async () => {
    const session = await ChatExportSession.create({
      parentDir: outputDir,
      format: 'text',
      chat: FIXTURE_CHAT,
      attachmentsDir,
      getDateParts: getUtcDateParts,
    });
    await session.writeMessages([message([])]);
    const during = await readdir(outputDir);
    assert.lengthOf(during, 1);
    assert.isTrue(isPartialExportName(during[0] ?? ''), during[0]);
    assert.notInclude(during[0], 'Book Club');
    assert.strictEqual(session.folderPath, session.partialPath);

    const filePath = await session.finish();
    assert.deepEqual(await readdir(outputDir), ['Book Club 2026-10-08 1500']);
    assert.strictEqual(
      filePath,
      join(outputDir, 'Book Club 2026-10-08 1500', 'chat.txt')
    );
    assert.include(await readFile(filePath, 'utf8'), 'pictures');
  });

  it('abortNow removes the partial folder right away', async () => {
    const session = await ChatExportSession.create({
      parentDir: outputDir,
      format: 'html',
      chat: FIXTURE_CHAT,
      attachmentsDir,
      getDateParts: getUtcDateParts,
    });
    assert.lengthOf(await readdir(outputDir), 1, 'negative control');
    session.abortNow();
    assert.deepEqual(await readdir(outputDir), []);
    let error: unknown;
    try {
      await session.writeMessages([message([])]);
    } catch (caught) {
      error = caught;
    }
    assert.instanceOf(error, Error);
  });

  it('only calls Wren-shaped names partial exports', () => {
    assert.isTrue(isPartialExportName('.wren-export-0123456789abcdef.partial'));
    assert.isFalse(isPartialExportName('Book Club.partial'));
    assert.isFalse(isPartialExportName('.wren-export-../../x.partial'));
    assert.isFalse(isPartialExportName('.wren-export-0123456789abcdef'));
  });

  it('removes the partial export on abort', async () => {
    const session = await ChatExportSession.create({
      parentDir: outputDir,
      format: 'html',
      chat: FIXTURE_CHAT,
      attachmentsDir,
      getDateParts: getUtcDateParts,
    });
    await session.writeMessages([message([])]);
    assert.lengthOf(await readdir(outputDir), 1, 'negative control');
    await session.abort();
    assert.deepEqual(await readdir(outputDir), []);
  });

  it('rejects relative parent folders', async () => {
    let error: unknown;
    try {
      await ChatExportSession.create({
        parentDir: 'relative/path',
        format: 'html',
        chat: FIXTURE_CHAT,
        attachmentsDir,
      });
    } catch (caught) {
      error = caught;
    }
    assert.instanceOf(error, Error);
  });
});
