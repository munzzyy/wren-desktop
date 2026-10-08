// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

export const EXPORT_FORMATS = ['html', 'text', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: unknown): value is ExportFormat {
  return (
    typeof value === 'string' &&
    (EXPORT_FORMATS as ReadonlyArray<string>).includes(value)
  );
}

export const EXPORT_FILE_NAMES: Readonly<Record<ExportFormat, string>> = {
  html: 'chat.html',
  text: 'chat.txt',
  json: 'chat.json',
};

export type ExportChat = Readonly<{
  id: string;
  name: string;
  type: 'direct' | 'group';
  exportedAt: number;
  includesMedia: boolean;
}>;

export type ExportAttachmentSource = Readonly<{
  path: string;
  version?: 1 | 2;
  localKey?: string;
  size?: number;
}>;

export type ExportAttachmentStatus = 'exported' | 'missing' | 'not-included';

export type ExportAttachment = Readonly<{
  contentType: string;
  size: number;
  fileName?: string;
  isVoiceNote: boolean;
  isSticker: boolean;
  status: ExportAttachmentStatus;
  mediaPath?: string;
  source?: ExportAttachmentSource;
}>;

export type ExportQuote = Readonly<{
  authorName: string;
  text: string;
  attachmentNames: ReadonlyArray<string>;
  isOriginalMissing: boolean;
}>;

export type ExportReaction = Readonly<{
  emoji: string;
  fromName: string;
  timestamp: number;
}>;

export type ExportLink = Readonly<{
  url: string;
  title?: string;
  description?: string;
  domain?: string;
}>;

export type ExportMessage = Readonly<{
  id: string;
  kind: 'message' | 'system';
  sentAt: number;
  receivedAt: number;
  authorName: string;
  isOutgoing: boolean;
  body: string;
  isDeleted: boolean;
  isViewOnce: boolean;
  isEdited: boolean;
  expireTimerSeconds?: number;
  quote?: ExportQuote;
  reactions: ReadonlyArray<ExportReaction>;
  attachments: ReadonlyArray<ExportAttachment>;
  links: ReadonlyArray<ExportLink>;
}>;
