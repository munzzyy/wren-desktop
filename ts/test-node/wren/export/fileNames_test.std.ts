// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  FALLBACK_CHAT_NAME,
  MAX_CHAT_NAME_LENGTH,
  getExportFolderName,
  getMediaFileName,
  sanitizeChatName,
} from '../../../wren/export/fileNames.std.ts';
import { getUtcDateParts } from '../../../wren/export/time.std.ts';

const lookup = (contentType: string): string | undefined =>
  ({
    'image/jpeg': 'jpg',
    'video/quicktime': 'mov',
    'image/svg+xml': 'svg+xml',
  })[contentType];

describe('wren/export/fileNames', () => {
  describe('sanitizeChatName', () => {
    it('strips path separators and reserved characters', () => {
      const input = '../../etc/passwd\\win:*?"<>|';
      assert.include(input, '/', 'negative control');
      const result = sanitizeChatName(input);
      assert.notMatch(result, /[/\\:*?"<>|]/);
      assert.strictEqual(result, 'etc passwd win');
    });

    it('removes leading and trailing dots', () => {
      assert.strictEqual(sanitizeChatName('...hidden...'), 'hidden');
      assert.strictEqual(sanitizeChatName('..'), FALLBACK_CHAT_NAME);
      assert.strictEqual(sanitizeChatName('a.b'), 'a.b');
    });

    it('drops control and bidi characters and collapses whitespace', () => {
      const input = 'Al\u0000ice\u0007 \t\n and \u202Ebob\u2066';
      assert.match(input, /\p{Cc}/u, 'negative control');
      const result = sanitizeChatName(input);
      assert.notMatch(result, /\p{Cc}/u);
      assert.notMatch(result, /[\u202A-\u202E\u2066-\u2069]/);
      assert.strictEqual(result, 'Al ice and bob');
    });

    it('caps long names without splitting characters', () => {
      const long = '\u{1F426}'.repeat(MAX_CHAT_NAME_LENGTH + 20);
      const result = sanitizeChatName(long);
      assert.strictEqual(result, '\u{1F426}'.repeat(MAX_CHAT_NAME_LENGTH));
    });

    it('falls back to "chat" for empty names', () => {
      assert.strictEqual(sanitizeChatName(''), 'chat');
      assert.strictEqual(sanitizeChatName('   '), 'chat');
      assert.strictEqual(sanitizeChatName('///'), 'chat');
      assert.strictEqual(sanitizeChatName('\u0000\u0001'), 'chat');
    });
  });

  describe('getExportFolderName', () => {
    it('appends the export time', () => {
      assert.strictEqual(
        getExportFolderName(
          'Book/Club',
          Date.UTC(2026, 9, 8, 14, 3),
          getUtcDateParts
        ),
        'Book Club 2026-10-08 1403'
      );
    });
  });

  describe('getMediaFileName', () => {
    it('uses the original extension when it is safe', () => {
      assert.strictEqual(
        getMediaFileName(
          {
            messageId: 'abc',
            index: 1,
            fileName: 'Holiday.JPEG',
            contentType: 'image/jpeg',
          },
          lookup
        ),
        'abc-1.jpeg'
      );
    });

    it('falls back to the content type for unsafe or missing extensions', () => {
      assert.strictEqual(
        getMediaFileName(
          {
            messageId: 'abc',
            index: 2,
            fileName: 'evil.jp g/../../x',
            contentType: 'image/jpeg',
          },
          lookup
        ),
        'abc-2.jpg'
      );
      assert.strictEqual(
        getMediaFileName(
          { messageId: 'abc', index: 3, contentType: 'video/quicktime' },
          lookup
        ),
        'abc-3.mov'
      );
      assert.strictEqual(
        getMediaFileName(
          {
            messageId: 'abc',
            index: 4,
            fileName: '.bashrc',
            contentType: 'x/y',
          },
          lookup
        ),
        'abc-4.bin'
      );
    });

    it('rejects unsafe extensions from the lookup', () => {
      assert.strictEqual(
        getMediaFileName(
          { messageId: 'abc', index: 1, contentType: 'image/svg+xml' },
          lookup
        ),
        'abc-1.bin'
      );
    });

    it('never lets the message id escape the media folder', () => {
      const name = getMediaFileName(
        { messageId: '../../x/y', index: 1, contentType: 'image/jpeg' },
        lookup
      );
      assert.strictEqual(name, 'xy-1.jpg');
      assert.strictEqual(
        getMediaFileName(
          { messageId: '../', index: 1, contentType: 'image/jpeg' },
          lookup
        ),
        'message-1.jpg'
      );
    });
  });
});
