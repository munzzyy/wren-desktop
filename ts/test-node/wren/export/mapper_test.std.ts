// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import type { MessageAttributesType } from '../../../model-types.d.ts';
import type { AciString } from '../../../types/ServiceId.std.ts';
import { stringToMIMEType } from '../../../types/MIME.std.ts';
import { isVoiceMessage } from '../../../util/Attachment.std.ts';
import { DurationInSeconds } from '../../../util/durations/index.std.ts';
import type { Emoji } from '../../../axo/emoji.std.ts';
import {
  mapMessageToExport,
  renderMentions,
  type MapperContext,
} from '../../../wren/export/mapper.std.ts';

const ALICE_ACI = 'aaaaaaaa-1111-4111-8111-111111111111' as AciString;
const BOB_ACI = 'bbbbbbbb-2222-4222-8222-222222222222' as AciString;

const NAMES_BY_SERVICE_ID: Record<string, string> = {
  [ALICE_ACI]: 'Alice',
  [BOB_ACI]: 'Bob',
};
const NAMES_BY_CONVERSATION_ID: Record<string, string> = {
  'conv-alice': 'Alice',
  'conv-bob': 'Bob',
  'conv-me': 'Me',
};

function createContext(overrides: Partial<MapperContext> = {}): MapperContext {
  return {
    includeMedia: true,
    ourName: 'Me',
    getNameByConversationId: id => NAMES_BY_CONVERSATION_ID[id],
    getNameByServiceIdOrE164: id => NAMES_BY_SERVICE_ID[id],
    isSystemMessage: message =>
      message.type !== 'incoming' && message.type !== 'outgoing',
    describeMessage: message =>
      message.type === 'timer-notification' ? 'Timer set to 1 hour' : '',
    isVoiceMessage,
    ...overrides,
  };
}

function createMessage(
  overrides: Partial<MessageAttributesType>
): MessageAttributesType {
  return {
    id: 'msg-1',
    type: 'incoming',
    conversationId: 'conv-group',
    sent_at: 1000,
    received_at: 1,
    received_at_ms: 1500,
    timestamp: 1000,
    sourceServiceId: ALICE_ACI,
    ...overrides,
  };
}

const IMAGE = {
  contentType: stringToMIMEType('image/jpeg'),
  size: 2048,
  fileName: 'cat.jpg',
  path: 'ab/abcdef',
  version: 2 as const,
  localKey: 'bG9jYWxrZXk=',
};

describe('wren/export/mapper', () => {
  it('maps an incoming message with mentions, quote, reactions and an image', () => {
    const body = 'Hi \uFFFC, look';
    const result = mapMessageToExport(
      createMessage({
        body,
        bodyRanges: [{ start: 3, length: 1, mentionAci: BOB_ACI }],
        expireTimer: DurationInSeconds.fromSeconds(3600),
        quote: {
          id: 1,
          authorAci: BOB_ACI,
          text: 'original',
          attachments: [{ contentType: stringToMIMEType('video/mp4') }],
          isViewOnce: false,
          referencedMessageNotFound: false,
        },
        reactions: [
          {
            emoji: '\u{1F44D}' as Emoji.Variant,
            fromId: 'conv-bob',
            targetTimestamp: 1000,
            timestamp: 2000,
          },
          {
            emoji: undefined,
            fromId: 'conv-me',
            targetTimestamp: 1000,
            timestamp: 2100,
          },
        ],
        attachments: [IMAGE],
        preview: [
          {
            url: 'https://example.com',
            title: 'Example',
            description: '',
            domain: 'example.com',
          },
        ],
      }),
      createContext()
    );

    assert.deepEqual(result, {
      id: 'msg-1',
      kind: 'message',
      sentAt: 1000,
      receivedAt: 1500,
      isOutgoing: false,
      expireTimerSeconds: 3600,
      authorName: 'Alice',
      body: 'Hi @Bob, look',
      isDeleted: false,
      isViewOnce: false,
      isEdited: false,
      quote: {
        authorName: 'Bob',
        text: 'original',
        attachmentNames: ['Video'],
        isOriginalMissing: false,
      },
      reactions: [{ emoji: '\u{1F44D}', fromName: 'Bob', timestamp: 2000 }],
      attachments: [
        {
          contentType: 'image/jpeg',
          size: 2048,
          fileName: 'cat.jpg',
          isVoiceNote: false,
          isSticker: false,
          status: 'exported',
          mediaPath: 'media/msg-1-1.jpg',
          source: {
            path: 'ab/abcdef',
            version: 2,
            localKey: 'bG9jYWxrZXk=',
            size: 2048,
          },
        },
      ],
      links: [
        {
          url: 'https://example.com',
          title: 'Example',
          description: undefined,
          domain: 'example.com',
        },
      ],
    });
  });

  it('names outgoing messages after us', () => {
    const result = mapMessageToExport(
      createMessage({
        type: 'outgoing',
        body: 'yo',
        sourceServiceId: undefined,
      }),
      createContext()
    );
    assert.isTrue(result.isOutgoing);
    assert.strictEqual(result.authorName, 'Me');
  });

  it('uses the update description for system messages', () => {
    const result = mapMessageToExport(
      createMessage({ type: 'timer-notification', body: 'ignored' }),
      createContext()
    );
    assert.strictEqual(result.kind, 'system');
    assert.strictEqual(result.body, 'Timer set to 1 hour');
    assert.deepEqual(result.attachments, []);
  });

  it('drops content of deleted and view-once messages', () => {
    const deleted = mapMessageToExport(
      createMessage({
        body: 'secret',
        deletedForEveryone: true,
        attachments: [IMAGE],
      }),
      createContext()
    );
    assert.isTrue(deleted.isDeleted);
    assert.strictEqual(deleted.body, '');
    assert.deepEqual(deleted.attachments, []);

    const viewOnce = mapMessageToExport(
      createMessage({ isViewOnce: true, attachments: [IMAGE] }),
      createContext()
    );
    assert.isTrue(viewOnce.isViewOnce);
    assert.deepEqual(viewOnce.attachments, []);
  });

  it('marks undownloaded attachments missing and respects include media', () => {
    const notDownloaded = { ...IMAGE, path: undefined };
    const missing = mapMessageToExport(
      createMessage({ attachments: [notDownloaded] }),
      createContext()
    );
    assert.strictEqual(missing.attachments[0]?.status, 'missing');
    assert.isUndefined(missing.attachments[0]?.source);

    const withoutMedia = mapMessageToExport(
      createMessage({ attachments: [IMAGE] }),
      createContext({ includeMedia: false })
    );
    assert.strictEqual(withoutMedia.attachments[0]?.status, 'not-included');
    assert.isUndefined(withoutMedia.attachments[0]?.mediaPath);
  });

  it('flags voice notes and stickers', () => {
    const voice = {
      contentType: stringToMIMEType('audio/aac'),
      size: 10,
      path: 'cd/voice',
      flags: 1,
    };
    const result = mapMessageToExport(
      createMessage({
        attachments: [voice],
        sticker: {
          packId: 'pack',
          packKey: 'key',
          stickerId: 1,
          data: {
            contentType: stringToMIMEType('image/webp'),
            size: 20,
            path: 'ef/sticker',
          },
        },
      }),
      createContext()
    );
    assert.isTrue(result.attachments[0]?.isVoiceNote);
    assert.isFalse(result.attachments[0]?.isSticker);
    assert.isTrue(result.attachments[1]?.isSticker);
    assert.strictEqual(result.attachments[1]?.mediaPath, 'media/msg-1-2.webp');
  });

  it('falls back to Unknown for unresolved authors', () => {
    const result = mapMessageToExport(
      createMessage({ sourceServiceId: undefined, conversationId: 'nope' }),
      createContext()
    );
    assert.strictEqual(result.authorName, 'Unknown');
  });

  describe('renderMentions', () => {
    it('replaces each mention placeholder with @name', () => {
      assert.strictEqual(
        renderMentions(
          '\uFFFC and \uFFFC',
          [
            { start: 0, length: 1, mentionAci: ALICE_ACI },
            { start: 6, length: 1, mentionAci: BOB_ACI },
          ],
          id => NAMES_BY_SERVICE_ID[id]
        ),
        '@Alice and @Bob'
      );
    });

    it('ignores out-of-range and overlapping ranges', () => {
      assert.strictEqual(
        renderMentions(
          'ab\uFFFC',
          [
            { start: 2, length: 1, mentionAci: ALICE_ACI },
            { start: 1, length: 2, mentionAci: BOB_ACI },
            { start: 5, length: 1, mentionAci: BOB_ACI },
          ],
          id => NAMES_BY_SERVICE_ID[id]
        ),
        'ab@Alice'
      );
    });

    it('negative control: formatting ranges are not mentions', () => {
      assert.strictEqual(
        renderMentions('bold', [{ start: 0, length: 4, style: 1 }], () => 'X'),
        'bold'
      );
    });
  });
});
