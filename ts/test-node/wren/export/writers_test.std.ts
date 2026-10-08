// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { ExportMessage } from '../../../wren/export/model.std.ts';
import {
  escapeHtml,
  formatSize,
  getSafeHref,
} from '../../../wren/export/writers.std.ts';
import { formatTimer } from '../../../wren/export/time.std.ts';
import { isUnsafeTextCodePoint } from '../../../wren/export/unsafeText.std.ts';
import {
  FIXTURE_CHAT,
  FIXTURE_IMAGE,
  FIXTURE_MESSAGES,
  at,
  fixtureMessage,
  render,
} from './fixture.std.ts';

const TEXT_GOLDEN = [
  'Chat: Book Club',
  'Exported from Wren: 2026-10-08 15:00',
  'Media: included',
  '',
  '[2026-10-08 14:03] Me: Hello there',
  '    (disappears after 1h)',
  '',
  '[2026-10-08 14:05] Alice: Look at this',
  '    > Me: Hello there',
  '    [image] cat.jpg (2.0 KB) -> media/m2-1.jpg',
  '    Reactions: \u{1F44D} Bob, \u2764\uFE0F Me',
  '',
  '[2026-10-08 14:06] * Alice changed the group name to "Book Club".',
  '',
  '[2026-10-08 14:07] Bob: (This message was deleted.)',
  '',
  '[2026-10-08 14:08] Alice: (View-once media. Not exported.)',
  '',
  '[2026-10-08 14:09] Bob: https://example.com/post',
  '    [link] https://example.com/post A post',
  '',
  '',
].join('\n');

const SCRIPT_SCHEME = ['java', 'script:'].join('');

const HOSTILE_ATTACHMENT = {
  contentType: 'application/pdf',
  size: 10,
  fileName: '"><script>a()</script>.pdf',
  isVoiceNote: false,
  isSticker: false,
  status: 'missing',
} as const;

function hostileMessage(): ExportMessage {
  return {
    id: 'evil"id',
    kind: 'message',
    sentAt: at(10),
    receivedAt: at(10),
    authorName: '<img src=x onerror=alert(1)>',
    isOutgoing: false,
    body: '<script>alert("pwned")</script> & \'quotes\' "double"',
    isDeleted: false,
    isViewOnce: false,
    isEdited: false,
    quote: {
      authorName: '"><b>quote</b>',
      text: '</blockquote><script>x()</script>',
      attachmentNames: ['<i>file</i>.png'],
      isOriginalMissing: true,
    },
    reactions: [
      { emoji: '<b>', fromName: '" onmouseover="x()', timestamp: at(11) },
    ],
    attachments: [HOSTILE_ATTACHMENT],
    links: [
      {
        url: `${SCRIPT_SCHEME}alert(document.cookie)`,
        title: '<u>click</u>',
      },
      { url: `${SCRIPT_SCHEME.toUpperCase()}alert(1)` },
      { url: 'data:text/html,<script>alert(1)</script>' },
      { url: 'https://ok.example/"onfocus="x' },
    ],
  };
}

describe('wren/export/writers', () => {
  describe('text', () => {
    it('matches the golden output for the fixture', () => {
      assert.strictEqual(render('text'), TEXT_GOLDEN);
    });

    it('negative control: a changed fixture no longer matches the golden', () => {
      const changed = FIXTURE_MESSAGES.map(message =>
        message.id === 'm1' ? { ...message, body: 'Hello there!' } : message
      );
      assert.notStrictEqual(render('text', changed), TEXT_GOLDEN);
    });

    it('indents continuation lines so they cannot pose as new messages', () => {
      const output = render('text', [
        {
          ...fixtureMessage('m1'),
          body: 'line one\n[2026-01-01 00:00] Mallory: fake',
        },
      ]);
      assert.include(
        output,
        'Me: line one\n    [2026-01-01 00:00] Mallory: fake'
      );
      assert.notInclude(output, '\n[2026-01-01 00:00] Mallory');
    });
  });

  describe('json', () => {
    it('produces one parseable object with chat metadata and messages', () => {
      const output = render('json');
      const parsed = JSON.parse(output);

      assert.strictEqual(parsed.format, 'wren-chat-export');
      assert.strictEqual(parsed.version, 1);
      assert.deepEqual(parsed.chat, {
        id: 'conversation-1',
        name: 'Book Club',
        type: 'group',
        exportedAt: Date.UTC(2026, 9, 8, 15, 0),
        exportedAtIso: '2026-10-08T15:00:00.000Z',
        includesMedia: true,
      });
      assert.lengthOf(parsed.messages, FIXTURE_MESSAGES.length);
      assert.deepEqual(
        parsed.messages.map((message: { id: string }) => message.id),
        ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']
      );
    });

    it('matches the golden record for the quoted image message', () => {
      const parsed = JSON.parse(render('json'));
      assert.deepEqual(parsed.messages[1], {
        id: 'm2',
        kind: 'message',
        sentAt: at(5),
        sentAtIso: '2026-10-08T14:05:00.000Z',
        receivedAt: at(5) + 1000,
        receivedAtIso: '2026-10-08T14:05:01.000Z',
        author: 'Alice',
        outgoing: false,
        body: 'Look at this',
        deleted: false,
        viewOnce: false,
        edited: false,
        expireTimerSeconds: null,
        quote: {
          author: 'Me',
          text: 'Hello there',
          attachments: [],
          originalMissing: false,
        },
        reactions: [
          {
            emoji: '\u{1F44D}',
            from: 'Bob',
            timestamp: at(6),
            timestampIso: '2026-10-08T14:06:00.000Z',
          },
          {
            emoji: '\u2764\uFE0F',
            from: 'Me',
            timestamp: at(7),
            timestampIso: '2026-10-08T14:07:00.000Z',
          },
        ],
        attachments: [
          {
            fileName: 'cat.jpg',
            contentType: 'image/jpeg',
            size: 2048,
            voiceNote: false,
            sticker: false,
            status: 'exported',
            path: 'media/m2-1.jpg',
          },
        ],
        links: [],
      });
      assert.strictEqual(parsed.messages[0].expireTimerSeconds, 3600);
      assert.strictEqual(parsed.messages[2].kind, 'system');
      assert.isTrue(parsed.messages[3].deleted);
      assert.isTrue(parsed.messages[4].viewOnce);
      assert.deepEqual(parsed.messages[5].links, [
        {
          url: 'https://example.com/post',
          title: 'A post',
          description: 'About things',
          domain: 'example.com',
        },
      ]);
    });

    it('writes an empty messages array for an empty chat', () => {
      const parsed = JSON.parse(render('json', []));
      assert.deepEqual(parsed.messages, []);
    });

    it('escapes hostile content and never leaks attachment keys', () => {
      const evil = hostileMessage();
      const withSource: ExportMessage = {
        ...evil,
        attachments: [
          {
            ...HOSTILE_ATTACHMENT,
            source: {
              path: 'ab/cd',
              version: 2,
              localKey: 'SECRETKEY',
              size: 1,
            },
          },
        ],
      };
      const output = render('json', [withSource]);
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.messages[0].body, evil.body);
      assert.strictEqual(parsed.messages[0].author, evil.authorName);
      assert.notInclude(output, 'SECRETKEY');
      assert.notInclude(output, 'ab/cd');

      const control = JSON.stringify(withSource);
      assert.include(control, 'SECRETKEY', 'negative control');
    });
  });

  describe('html', () => {
    const html = render('html');

    it('is a self-contained page with a strict policy and no script', () => {
      assert.match(html, /^<!doctype html>\n<html lang="en">/);
      assert.include(html, '<meta charset="utf-8">');
      assert.include(html, "script-src 'none'");
      assert.include(html, "default-src 'none'");
      assert.notMatch(html, /<script/i);
      assert.notMatch(html, /\bsrc="https?:/i);
      assert.notMatch(html, /<link\b/i);
      assert.notMatch(html, /@import|url\(/i);
      assert.match(html, /<\/html>\n$/);
    });

    it('renders the outgoing message on the right with its timer', () => {
      assert.include(
        html,
        '<div class="msg out" id="m-m1"><div class="bubble">' +
          '<div class="meta"><span class="author">Me</span>' +
          '<time datetime="2026-10-08T14:03:00.000Z">2026-10-08 14:03</time></div>' +
          '<div class="body">Hello there</div>' +
          '<div class="timer">Disappears after 1h</div></div></div>'
      );
      assert.match(html, /\.msg\.out\{justify-content:flex-end\}/);
    });

    it('renders the quote, the image and both reactions', () => {
      assert.include(
        html,
        '<blockquote class="quote"><div class="quote-author">Me</div>' +
          '<div class="quote-text">Hello there</div></blockquote>'
      );
      assert.include(
        html,
        '<div class="att"><a href="media/m2-1.jpg">' +
          '<img src="media/m2-1.jpg" alt="cat.jpg" loading="lazy"></a></div>'
      );
      assert.include(
        html,
        '<div class="reactions"><span class="reaction" title="Bob">\u{1F44D}</span>' +
          '<span class="reaction" title="Me">\u2764\uFE0F</span></div>'
      );
    });

    it('centers and mutes the system message', () => {
      assert.include(
        html,
        '<div class="system" id="m-m3">Alice changed the group name to ' +
          '&quot;Book Club&quot;. &middot; <time'
      );
      assert.match(
        html,
        /\.system\{align-self:center;[^}]*color:var\(--muted\)/
      );
    });

    it('shows placeholders for deleted and view-once messages', () => {
      assert.include(
        html,
        '<div class="placeholder">This message was deleted.</div>'
      );
      assert.include(
        html,
        '<div class="placeholder">View-once media. Not exported.</div>'
      );
    });

    it('links the preview url', () => {
      assert.include(
        html,
        '<div class="link"><a href="https://example.com/post" ' +
          'rel="noopener noreferrer">A post</a><div>About things</div>' +
          '<div class="url">https://example.com/post</div></div>'
      );
    });

    it('uses audio and video elements for those media types', () => {
      const media: ExportMessage = {
        ...fixtureMessage('m2'),
        quote: undefined,
        reactions: [],
        attachments: [
          {
            ...FIXTURE_IMAGE,
            contentType: 'video/mp4',
            fileName: undefined,
            mediaPath: 'media/m2-1.mp4',
          },
          {
            ...FIXTURE_IMAGE,
            contentType: 'audio/aac',
            fileName: undefined,
            isVoiceNote: true,
            mediaPath: 'media/m2-2.aac',
          },
        ],
      };
      const output = render('html', [media]);
      assert.include(
        output,
        '<video controls preload="metadata" src="media/m2-1.mp4"></video>'
      );
      assert.include(
        output,
        '<audio controls preload="none" src="media/m2-2.aac"></audio>' +
          '<a href="media/m2-2.aac">Voice message</a>'
      );
    });

    it('escapes hostile bodies, names and attributes', () => {
      const evil = hostileMessage();
      assert.include(evil.body, '<script>', 'negative control');

      const output = render('html', [evil]);
      const bodyStart = output.indexOf('<main>');
      const main = output.slice(bodyStart);

      assert.notInclude(main, '<script');
      assert.notInclude(main, '<img src=x');
      assert.notInclude(main, '<b>');
      assert.notInclude(main, '<i>');
      assert.notInclude(main, '<u>');
      assert.notInclude(main, '" onmouseover=');
      assert.include(
        main,
        '&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt; &amp; ' +
          '&#39;quotes&#39; &quot;double&quot;'
      );
      assert.include(main, 'id="m-evil&quot;id"');
      assert.include(main, 'title="&quot; onmouseover=&quot;x()"');
    });

    it('never turns non-http preview urls into links', () => {
      const output = render('html', [hostileMessage()]);
      assert.notMatch(output, /href="\s*javascript:/i);
      assert.notMatch(output, /href="\s*data:/i);
      assert.include(
        output,
        '<div class="url">javascript:alert(document.cookie)</div>'
      );
      assert.include(
        output,
        '<a href="https://ok.example/%22onfocus=%22x" rel="noopener noreferrer">'
      );
    });
  });

  describe('helpers', () => {
    it('escapeHtml covers text and attribute contexts', () => {
      assert.strictEqual(
        escapeHtml('<a href="x" title=\'y\'>&`</a>'),
        '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;'
      );
    });

    it('getSafeHref accepts only http and https', () => {
      assert.strictEqual(
        getSafeHref('https://a.example/b'),
        'https://a.example/b'
      );
      assert.strictEqual(
        getSafeHref('  HTTP://a.example '),
        'http://a.example/'
      );
      assert.isUndefined(getSafeHref(`${SCRIPT_SCHEME}alert(1)`));
      assert.isUndefined(getSafeHref('java\nscript:alert(1)'));
      assert.isUndefined(getSafeHref('//a.example/'));
      assert.isUndefined(getSafeHref('ftp://a.example/'));
      assert.isUndefined(getSafeHref('https://'));
    });

    it('formats sizes and timers', () => {
      assert.strictEqual(formatSize(512), '512 B');
      assert.strictEqual(formatSize(2048), '2.0 KB');
      assert.strictEqual(formatSize(5 * 1024 * 1024), '5.0 MB');
      assert.strictEqual(formatTimer(30), '30s');
      assert.strictEqual(formatTimer(300), '5m');
      assert.strictEqual(formatTimer(86400), '1d');
      assert.strictEqual(formatTimer(604800), '1w');
      assert.strictEqual(formatTimer(90), '90s');
    });
  });

  describe('media elements', () => {
    const withAttachment = (contentType: string, mediaPath: string) =>
      render('html', [
        {
          ...fixtureMessage('m2'),
          quote: undefined,
          reactions: [],
          attachments: [
            { ...FIXTURE_IMAGE, contentType, fileName: 'x', mediaPath },
          ],
        },
      ]);

    it('negative control: a passive image still gets an img element', () => {
      assert.include(
        withAttachment('image/png', 'media/m2-1.png'),
        '<img src="media/m2-1.png"'
      );
    });

    it('links active types as plain files instead of embedding them', () => {
      for (const contentType of ['image/svg+xml', 'text/html', 'video/x']) {
        const output = withAttachment(contentType, 'media/m2-1.bin');
        assert.notMatch(output, /<(img|video|audio)\b/, contentType);
        assert.include(output, '<a href="media/m2-1.bin">x</a>');
      }
    });
  });

  describe('control and bidi characters', () => {
    const ch = (...codePoints: Array<number>) =>
      String.fromCodePoint(...codePoints);
    const ESC = ch(0x1b);
    const C1 = ch(0x9b);
    const RLO = ch(0x202e);
    const LRI = ch(0x2066);
    const FFFD = ch(0xfffd);
    const BIDI = ch(
      0x200e,
      0x200f,
      0x202a,
      0x202b,
      0x202c,
      0x202d,
      0x202e,
      0x2066,
      0x2067,
      0x2068,
      0x2069
    );
    const unsafeOnly = `${ESC}${C1}\r${ch(0, 0x7f)}${BIDI}`;
    const hasUnsafe = (value: string) =>
      Array.from(value).some(char =>
        isUnsafeTextCodePoint(char.codePointAt(0) ?? 0)
      );

    const hostile: ExportMessage = {
      ...fixtureMessage('m2'),
      authorName: `Ali${unsafeOnly}ce`,
      body: `tab\there\nnext line ${ESC}[2J${C1}31m${unsafeOnly} end`,
      quote: {
        authorName: `B${ESC}ob`,
        text: `quoted ${RLO}`,
        attachmentNames: [`f${RLO}gpj.exe`],
        isOriginalMissing: false,
      },
      reactions: [{ emoji: 'x', fromName: `C${LRI}arol`, timestamp: at(6) }],
      attachments: [{ ...FIXTURE_IMAGE, fileName: `cat${ESC}.jpg` }],
      links: [{ url: 'https://a.example/', title: `t${ESC}itle` }],
    };

    it('negative control: the hostile message carries every unsafe class', () => {
      assert.isTrue(hasUnsafe(hostile.body));
      for (const char of Array.from(unsafeOnly)) {
        assert.isTrue(hasUnsafe(char), `U+${char.codePointAt(0)}`);
      }
      assert.isFalse(hasUnsafe('tab\tand\nnewline'));
    });

    it('chat.txt replaces them and keeps tabs and newlines', () => {
      const output = render('text', [hostile], {
        ...FIXTURE_CHAT,
        name: `Book${ESC}]0;pwned${ch(7)} Club`,
      });
      assert.isFalse(hasUnsafe(output));
      assert.include(
        output,
        `tab\there\n    next line ${FFFD}[2J${FFFD}31m${FFFD.repeat(16)} end`
      );
      assert.include(output, 'Chat: Book]0;pwned Club\n');
      assert.include(output, '] Alice: tab');
      assert.include(output, `> Bob: quoted ${FFFD}`);
      assert.include(output, '[fgpj.exe]');
      assert.include(output, 'x Carol');
      assert.include(output, '[image] cat.jpg (2.0 KB)');
      assert.include(output, `[link] https://a.example/ t${FFFD}itle`);
    });

    it('the HTML and JSON writers strip them from names', () => {
      const html = render('html', [hostile]);
      assert.include(html, '<span class="author">Alice</span>');
      assert.include(html, '<div class="quote-author">Bob</div>');
      assert.include(html, 'title="Carol"');
      assert.include(html, 'alt="cat.jpg"');

      const json = JSON.parse(render('json', [hostile]));
      const [message] = json.messages;
      assert.strictEqual(message.author, 'Alice');
      assert.strictEqual(message.quote.author, 'Bob');
      assert.deepEqual(message.quote.attachments, ['fgpj.exe']);
      assert.strictEqual(message.reactions[0].from, 'Carol');
      assert.strictEqual(message.attachments[0].fileName, 'cat.jpg');
      assert.strictEqual(message.body, hostile.body, 'bodies stay as sent');
    });
  });
});
