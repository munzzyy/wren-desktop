// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReadonlyDeep } from 'type-fest';

import type { ReadonlyMessageAttributesType } from '../../model-types.d.ts';
import type { AttachmentType } from '../../types/Attachment.std.ts';
import type { RawBodyRange } from '../../types/BodyRange.std.ts';
import type {
  ExportAttachment,
  ExportLink,
  ExportMessage,
  ExportQuote,
  ExportReaction,
} from './model.std.ts';
import { getMediaFileName, getMediaPath } from './fileNames.std.ts';

const UNKNOWN_NAME = 'Unknown';

export type MapperContext = Readonly<{
  includeMedia: boolean;
  ourName: string;
  getNameByConversationId: (conversationId: string) => string | undefined;
  getNameByServiceIdOrE164: (id: string) => string | undefined;
  isSystemMessage: (message: ReadonlyMessageAttributesType) => boolean;
  describeMessage: (message: ReadonlyMessageAttributesType) => string;
  isVoiceMessage: (attachment: ReadonlyDeep<AttachmentType>) => boolean;
}>;

export function renderMentions(
  body: string,
  bodyRanges: ReadonlyArray<ReadonlyDeep<RawBodyRange>> | undefined,
  resolveName: (aci: string) => string | undefined
): string {
  const mentions = (bodyRanges ?? [])
    .flatMap(range =>
      'mentionAci' in range && range.mentionAci
        ? [
            {
              start: range.start,
              end: range.start + range.length,
              aci: range.mentionAci,
            },
          ]
        : []
    )
    .filter(
      ({ start, end }) =>
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end >= start &&
        end <= body.length
    )
    .sort((a, b) => b.start - a.start);

  let result = body;
  let boundary = body.length;
  for (const mention of mentions) {
    if (mention.end > boundary) {
      continue;
    }
    const name = resolveName(mention.aci) ?? UNKNOWN_NAME;
    result = `${result.slice(0, mention.start)}@${name}${result.slice(mention.end)}`;
    boundary = mention.start;
  }
  return result;
}

function describeContentType(contentType: string): string {
  if (contentType.startsWith('image/')) {
    return 'Image';
  }
  if (contentType.startsWith('video/')) {
    return 'Video';
  }
  if (contentType.startsWith('audio/')) {
    return 'Audio';
  }
  return 'File';
}

function resolveAuthorName(
  message: ReadonlyMessageAttributesType,
  context: MapperContext
): string {
  if (message.type === 'outgoing') {
    return context.ourName;
  }
  const id = message.sourceServiceId ?? message.source;
  return (
    (id ? context.getNameByServiceIdOrE164(id) : undefined) ??
    context.getNameByConversationId(message.conversationId) ??
    UNKNOWN_NAME
  );
}

function mapAttachment(
  attachment: ReadonlyDeep<AttachmentType>,
  {
    messageId,
    index,
    isSticker,
  }: Readonly<{ messageId: string; index: number; isSticker: boolean }>,
  context: MapperContext
): ExportAttachment {
  const contentType = String(attachment.contentType ?? '');
  const base = {
    contentType,
    size: attachment.size ?? 0,
    fileName: attachment.fileName || undefined,
    isVoiceNote: !isSticker && context.isVoiceMessage(attachment),
    isSticker,
  };

  if (!context.includeMedia) {
    return { ...base, status: 'not-included' };
  }
  if (!attachment.path || attachment.pending || attachment.error) {
    return { ...base, status: 'missing' };
  }

  const mediaFileName = getMediaFileName({
    messageId,
    index,
    fileName: attachment.fileName,
    contentType,
  });
  return {
    ...base,
    status: 'exported',
    mediaPath: getMediaPath(mediaFileName),
    source: {
      path: attachment.path,
      version: attachment.version,
      localKey: attachment.localKey,
      size: attachment.size,
    },
  };
}

function mapQuote(
  message: ReadonlyMessageAttributesType,
  context: MapperContext
): ExportQuote | undefined {
  const { quote } = message;
  if (quote == null) {
    return undefined;
  }
  const authorId = quote.authorAci ?? quote.author;
  return {
    authorName:
      (authorId ? context.getNameByServiceIdOrE164(authorId) : undefined) ??
      UNKNOWN_NAME,
    text: renderMentions(
      quote.text ?? '',
      quote.bodyRanges,
      context.getNameByServiceIdOrE164
    ),
    attachmentNames: (quote.attachments ?? []).map(
      attachment =>
        attachment.fileName ||
        describeContentType(String(attachment.contentType ?? ''))
    ),
    isOriginalMissing: quote.referencedMessageNotFound,
  };
}

function mapReactions(
  message: ReadonlyMessageAttributesType,
  context: MapperContext
): ReadonlyArray<ExportReaction> {
  return (message.reactions ?? []).flatMap(reaction =>
    reaction.emoji
      ? [
          {
            emoji: reaction.emoji,
            fromName:
              context.getNameByConversationId(reaction.fromId) ?? UNKNOWN_NAME,
            timestamp: reaction.timestamp,
          },
        ]
      : []
  );
}

function mapLinks(
  message: ReadonlyMessageAttributesType
): ReadonlyArray<ExportLink> {
  return (message.preview ?? []).flatMap(preview =>
    preview.url
      ? [
          {
            url: preview.url,
            title: preview.title || undefined,
            description: preview.description || undefined,
            domain: preview.domain || undefined,
          },
        ]
      : []
  );
}

export function mapMessageToExport(
  message: ReadonlyMessageAttributesType,
  context: MapperContext
): ExportMessage {
  const sentAt = message.sent_at ?? message.timestamp;
  const common = {
    id: message.id,
    sentAt,
    receivedAt: message.received_at_ms ?? sentAt,
    isOutgoing: message.type === 'outgoing',
    expireTimerSeconds: message.expireTimer
      ? Number(message.expireTimer)
      : undefined,
  };

  if (context.isSystemMessage(message)) {
    return {
      ...common,
      kind: 'system',
      authorName: '',
      body: context.describeMessage(message),
      isDeleted: false,
      isViewOnce: false,
      isEdited: false,
      reactions: [],
      attachments: [],
      links: [],
    };
  }

  const isDeleted = Boolean(message.deletedForEveryone);
  const isViewOnce = Boolean(message.isViewOnce);
  const authorName = resolveAuthorName(message, context);
  const reactions = mapReactions(message, context);
  const isEdited = (message.editHistory?.length ?? 0) > 1;

  if (isDeleted || isViewOnce) {
    return {
      ...common,
      kind: 'message',
      authorName,
      body: '',
      isDeleted,
      isViewOnce,
      isEdited,
      reactions,
      attachments: [],
      links: [],
    };
  }

  const attachments: Array<ExportAttachment> = [];
  for (const attachment of message.attachments ?? []) {
    attachments.push(
      mapAttachment(
        attachment,
        {
          messageId: message.id,
          index: attachments.length + 1,
          isSticker: false,
        },
        context
      )
    );
  }
  if (message.sticker?.data) {
    attachments.push(
      mapAttachment(
        message.sticker.data,
        {
          messageId: message.id,
          index: attachments.length + 1,
          isSticker: true,
        },
        context
      )
    );
  }

  const links = mapLinks(message);
  let body = renderMentions(
    message.body ?? '',
    message.bodyRanges,
    context.getNameByServiceIdOrE164
  );
  if (!body && attachments.length === 0 && links.length === 0) {
    body = context.describeMessage(message);
  }

  return {
    ...common,
    kind: 'message',
    authorName,
    body,
    isDeleted,
    isViewOnce,
    isEdited,
    quote: mapQuote(message, context),
    reactions,
    attachments,
    links,
  };
}
