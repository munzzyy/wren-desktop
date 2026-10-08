// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import {
  formatCompactDateTime,
  getLocalDateParts,
  type GetDateParts,
} from './time.std.ts';

export const MAX_CHAT_NAME_LENGTH = 64;
export const FALLBACK_CHAT_NAME = 'chat';
export const MEDIA_DIR = 'media';

const PATH_SEPARATORS_AND_RESERVED = /[/\\:*?"<>|]/g;

function isInvisibleOrControl(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

function stripControlCharacters(value: string): string {
  let result = '';
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    result += isInvisibleOrControl(codePoint) ? ' ' : char;
  }
  return result;
}

function trimDotsAndSpaces(value: string): string {
  return value.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
}

export function sanitizeChatName(name: string): string {
  const cleaned = trimDotsAndSpaces(
    stripControlCharacters(name.normalize('NFC'))
      .replace(PATH_SEPARATORS_AND_RESERVED, ' ')
      .replace(/\s+/g, ' ')
  );
  const capped = trimDotsAndSpaces(
    Array.from(cleaned).slice(0, MAX_CHAT_NAME_LENGTH).join('')
  );
  return capped.length > 0 ? capped : FALLBACK_CHAT_NAME;
}

export function getExportFolderName(
  chatName: string,
  exportedAt: number,
  getDateParts: GetDateParts = getLocalDateParts
): string {
  const stamp = formatCompactDateTime(getDateParts(exportedAt));
  return `${sanitizeChatName(chatName)} ${stamp}`;
}

export type MediaKindType = 'image' | 'video' | 'audio';

type PassiveTypeType = Readonly<{
  extensions: ReadonlyArray<string>;
  kind?: MediaKindType;
}>;

// Types a browser or file manager opens as data. Everything else, html, svg,
// xml and scripts included, is written as .bin so it can't run next to
// chat.html.
const PASSIVE_TYPES: Readonly<Record<string, PassiveTypeType>> = {
  'image/jpeg': { extensions: ['jpg', 'jpeg', 'jpe'], kind: 'image' },
  'image/png': { extensions: ['png'], kind: 'image' },
  'image/gif': { extensions: ['gif'], kind: 'image' },
  'image/webp': { extensions: ['webp'], kind: 'image' },
  'image/heic': { extensions: ['heic'], kind: 'image' },
  'image/heif': { extensions: ['heif'], kind: 'image' },
  'image/avif': { extensions: ['avif'], kind: 'image' },
  'image/bmp': { extensions: ['bmp'], kind: 'image' },
  'video/mp4': { extensions: ['mp4', 'm4v'], kind: 'video' },
  'video/quicktime': { extensions: ['mov'], kind: 'video' },
  'video/webm': { extensions: ['webm'], kind: 'video' },
  'video/3gpp': { extensions: ['3gp'], kind: 'video' },
  'audio/mp4': { extensions: ['m4a'], kind: 'audio' },
  'audio/x-m4a': { extensions: ['m4a'], kind: 'audio' },
  'audio/aac': { extensions: ['aac'], kind: 'audio' },
  'audio/mpeg': { extensions: ['mp3'], kind: 'audio' },
  'audio/mp3': { extensions: ['mp3'], kind: 'audio' },
  'audio/ogg': { extensions: ['ogg', 'oga', 'opus'], kind: 'audio' },
  'audio/opus': { extensions: ['opus'], kind: 'audio' },
  'audio/wav': { extensions: ['wav'], kind: 'audio' },
  'audio/x-wav': { extensions: ['wav'], kind: 'audio' },
  'audio/wave': { extensions: ['wav'], kind: 'audio' },
  'audio/flac': { extensions: ['flac'], kind: 'audio' },
  'audio/amr': { extensions: ['amr'] },
  'application/pdf': { extensions: ['pdf'] },
  'text/plain': { extensions: ['txt'] },
  'text/csv': { extensions: ['csv'] },
  'application/zip': { extensions: ['zip'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extensions: ['docx'],
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    extensions: ['xlsx'],
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    extensions: ['pptx'],
  },
  'application/vnd.oasis.opendocument.text': { extensions: ['odt'] },
  'application/vnd.oasis.opendocument.spreadsheet': { extensions: ['ods'] },
  'application/vnd.oasis.opendocument.presentation': { extensions: ['odp'] },
};

export const FALLBACK_EXTENSION = 'bin';

function getPassiveType(contentType: string): PassiveTypeType | undefined {
  const essence = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return Object.hasOwn(PASSIVE_TYPES, essence)
    ? PASSIVE_TYPES[essence]
    : undefined;
}

export function getMediaKind(contentType: string): MediaKindType | undefined {
  return getPassiveType(contentType)?.kind;
}

function extensionFromFileName(
  fileName: string | undefined
): string | undefined {
  if (fileName == null) {
    return undefined;
  }
  const base = fileName.split(/[/\\]/).pop() ?? '';
  const lastDot = base.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === base.length - 1) {
    return undefined;
  }
  return base
    .slice(lastDot + 1)
    .trim()
    .toLowerCase();
}

export function getMediaExtension(
  fileName: string | undefined,
  contentType: string
): string {
  const passive = getPassiveType(contentType);
  if (passive == null) {
    return FALLBACK_EXTENSION;
  }
  const original = extensionFromFileName(fileName);
  if (original != null && passive.extensions.includes(original)) {
    return original;
  }
  return passive.extensions[0] ?? FALLBACK_EXTENSION;
}

export function getMediaFileName({
  messageId,
  index,
  fileName,
  contentType,
}: Readonly<{
  messageId: string;
  index: number;
  fileName?: string;
  contentType: string;
}>): string {
  const safeId =
    messageId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64) || 'message';
  return `${safeId}-${index}.${getMediaExtension(fileName, contentType)}`;
}

export function getMediaPath(mediaFileName: string): string {
  return `${MEDIA_DIR}/${mediaFileName}`;
}
