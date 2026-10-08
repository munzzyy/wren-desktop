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
const SAFE_EXTENSION = /^[a-z0-9]{1,10}$/;

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

function normalizeExtension(candidate: string | undefined): string | undefined {
  if (candidate == null) {
    return undefined;
  }
  const lower = candidate.trim().toLowerCase();
  return SAFE_EXTENSION.test(lower) ? lower : undefined;
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
  return normalizeExtension(base.slice(lastDot + 1));
}

export type ExtensionLookup = (contentType: string) => string | undefined;

export function getMediaFileName(
  {
    messageId,
    index,
    fileName,
    contentType,
  }: Readonly<{
    messageId: string;
    index: number;
    fileName?: string;
    contentType: string;
  }>,
  lookupExtension: ExtensionLookup
): string {
  const safeId =
    messageId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64) || 'message';
  const extension =
    extensionFromFileName(fileName) ??
    normalizeExtension(lookupExtension(contentType)) ??
    'bin';
  return `${safeId}-${index}.${extension}`;
}

export function getMediaPath(mediaFileName: string): string {
  return `${MEDIA_DIR}/${mediaFileName}`;
}
