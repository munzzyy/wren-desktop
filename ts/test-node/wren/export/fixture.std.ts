// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  ExportAttachment,
  ExportChat,
  ExportFormat,
  ExportMessage,
} from '../../../wren/export/model.std.ts';
import { createChatWriter } from '../../../wren/export/writers.std.ts';
import { getUtcDateParts } from '../../../wren/export/time.std.ts';

export const at = (minute: number): number => Date.UTC(2026, 9, 8, 14, minute);

export const FIXTURE_CHAT: ExportChat = {
  id: 'conversation-1',
  name: 'Book Club',
  type: 'group',
  exportedAt: Date.UTC(2026, 9, 8, 15, 0),
  includesMedia: true,
};

const base = {
  isOutgoing: false,
  isDeleted: false,
  isViewOnce: false,
  isEdited: false,
  reactions: [],
  attachments: [],
  links: [],
} as const;

export const FIXTURE_IMAGE: ExportAttachment = {
  contentType: 'image/jpeg',
  size: 2048,
  fileName: 'cat.jpg',
  isVoiceNote: false,
  isSticker: false,
  status: 'exported',
  mediaPath: 'media/m2-1.jpg',
};

export const FIXTURE_MESSAGES: ReadonlyArray<ExportMessage> = [
  {
    ...base,
    id: 'm1',
    kind: 'message',
    sentAt: at(3),
    receivedAt: at(3),
    authorName: 'Me',
    isOutgoing: true,
    body: 'Hello there',
    expireTimerSeconds: 3600,
  },
  {
    ...base,
    id: 'm2',
    kind: 'message',
    sentAt: at(5),
    receivedAt: at(5) + 1000,
    authorName: 'Alice',
    body: 'Look at this',
    quote: {
      authorName: 'Me',
      text: 'Hello there',
      attachmentNames: [],
      isOriginalMissing: false,
    },
    reactions: [
      { emoji: '\u{1F44D}', fromName: 'Bob', timestamp: at(6) },
      { emoji: '\u2764\uFE0F', fromName: 'Me', timestamp: at(7) },
    ],
    attachments: [FIXTURE_IMAGE],
  },
  {
    ...base,
    id: 'm3',
    kind: 'system',
    sentAt: at(6),
    receivedAt: at(6),
    authorName: '',
    body: 'Alice changed the group name to "Book Club".',
  },
  {
    ...base,
    id: 'm4',
    kind: 'message',
    sentAt: at(7),
    receivedAt: at(7),
    authorName: 'Bob',
    body: '',
    isDeleted: true,
  },
  {
    ...base,
    id: 'm5',
    kind: 'message',
    sentAt: at(8),
    receivedAt: at(8),
    authorName: 'Alice',
    body: '',
    isViewOnce: true,
  },
  {
    ...base,
    id: 'm6',
    kind: 'message',
    sentAt: at(9),
    receivedAt: at(9),
    authorName: 'Bob',
    body: 'https://example.com/post',
    links: [
      {
        url: 'https://example.com/post',
        title: 'A post',
        description: 'About things',
        domain: 'example.com',
      },
    ],
  },
];

export function fixtureMessage(id: string): ExportMessage {
  const found = FIXTURE_MESSAGES.find(message => message.id === id);
  if (found == null) {
    throw new Error(`No fixture message ${id}`);
  }
  return found;
}

export function render(
  format: ExportFormat,
  messages: ReadonlyArray<ExportMessage> = FIXTURE_MESSAGES,
  chat: ExportChat = FIXTURE_CHAT
): string {
  let output = '';
  const writer = createChatWriter(
    format,
    chunk => {
      output += chunk;
    },
    { getDateParts: getUtcDateParts }
  );
  writer.writeHeader(chat);
  for (const message of messages) {
    writer.writeMessage(message);
  }
  writer.writeFooter();
  return output;
}
