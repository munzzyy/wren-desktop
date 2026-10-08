// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  FALLBACK_CHAT_NAME,
  MAX_CHAT_NAME_LENGTH,
  getExportFolderName,
  getMediaExtension,
  getMediaFileName,
  getMediaKind,
  sanitizeChatName,
} from '../../../wren/export/fileNames.std.ts';
import { getUtcDateParts } from '../../../wren/export/time.std.ts';

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
    it('keeps the original extension when it matches the content type', () => {
      assert.strictEqual(
        getMediaFileName({
          messageId: 'abc',
          index: 1,
          fileName: 'Holiday.JPEG',
          contentType: 'image/jpeg',
        }),
        'abc-1.jpeg'
      );
      assert.strictEqual(
        getMediaFileName({
          messageId: 'abc',
          index: 2,
          fileName: 'song.opus',
          contentType: 'audio/ogg; codecs=opus',
        }),
        'abc-2.opus'
      );
    });

    it('uses the content type when the name is missing or odd', () => {
      assert.strictEqual(
        getMediaFileName({
          messageId: 'abc',
          index: 2,
          fileName: 'evil.jp g/../../x',
          contentType: 'image/jpeg',
        }),
        'abc-2.jpg'
      );
      assert.strictEqual(
        getMediaFileName({
          messageId: 'abc',
          index: 3,
          contentType: 'video/quicktime',
        }),
        'abc-3.mov'
      );
      assert.strictEqual(
        getMediaFileName({
          messageId: 'abc',
          index: 4,
          fileName: '.bashrc',
          contentType: 'x/y',
        }),
        'abc-4.bin'
      );
    });

    it('never trusts a sender extension that differs from the type', () => {
      const name = 'photo.html';
      assert.match(name, /\.html$/, 'negative control');
      assert.strictEqual(
        getMediaFileName({
          messageId: 'abc',
          index: 1,
          fileName: name,
          contentType: 'image/png',
        }),
        'abc-1.png'
      );
      assert.strictEqual(
        getMediaFileName({
          messageId: 'abc',
          index: 2,
          fileName: 'page.png',
          contentType: 'text/html',
        }),
        'abc-2.bin'
      );
    });

    it('writes active types as .bin whatever they are called', () => {
      const cases: ReadonlyArray<[string, string]> = [
        ['image/svg+xml', 'x.svg'],
        ['text/html', 'x.html'],
        ['text/html', 'x.htm'],
        ['application/xhtml+xml', 'x.xhtml'],
        ['application/xml', 'x.xml'],
        ['text/xml', 'x.xml'],
        ['multipart/related', 'x.mht'],
        ['text/javascript', 'x.js'],
        ['application/hta', 'x.hta'],
        ['application/x-msdownload', 'x.exe'],
        ['application/octet-stream', 'x.scr'],
        ['application/octet-stream', 'x.jpg'],
        ['', 'x.html'],
      ];
      for (const [contentType, fileName] of cases) {
        const result = getMediaFileName({
          messageId: 'm',
          index: 1,
          fileName,
          contentType,
        });
        assert.strictEqual(result, 'm-1.bin', `${contentType} ${fileName}`);
      }
    });

    it('getMediaExtension never returns an active extension', () => {
      const active = /^(html?|xhtml|svg|xml|mht|js|hta|exe|scr)$/;
      const types = [
        'image/jpeg',
        'image/svg+xml',
        'text/html',
        'text/plain',
        'application/pdf',
        'audio/mpeg',
      ];
      const names = ['a.html', 'a.svg', 'a.js', 'a.exe', 'a', undefined];
      for (const contentType of types) {
        for (const fileName of names) {
          assert.notMatch(getMediaExtension(fileName, contentType), active);
        }
      }
      assert.match('html', active, 'negative control');
    });

    it('never lets the message id escape the media folder', () => {
      const name = getMediaFileName({
        messageId: '../../x/y',
        index: 1,
        contentType: 'image/jpeg',
      });
      assert.strictEqual(name, 'xy-1.jpg');
      assert.strictEqual(
        getMediaFileName({
          messageId: '../',
          index: 1,
          contentType: 'image/jpeg',
        }),
        'message-1.jpg'
      );
    });
  });

  describe('getMediaKind', () => {
    it('names only passive image, video and audio types', () => {
      assert.strictEqual(getMediaKind('image/png'), 'image');
      assert.strictEqual(getMediaKind('IMAGE/JPEG; q=1'), 'image');
      assert.strictEqual(getMediaKind('video/mp4'), 'video');
      assert.strictEqual(getMediaKind('audio/aac'), 'audio');
      assert.isUndefined(getMediaKind('image/svg+xml'));
      assert.isUndefined(getMediaKind('text/html'));
      assert.isUndefined(getMediaKind('application/pdf'));
      assert.isUndefined(getMediaKind('constructor'));
    });
  });
});
