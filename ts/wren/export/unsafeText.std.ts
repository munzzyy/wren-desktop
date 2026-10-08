// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd);

// Terminal controls and the bidi marks that can reorder what a reader sees:
// C0 except tab and newline, DEL, C1, LRM/RLM, the embeddings and overrides,
// and the isolates.
export function isUnsafeTextCodePoint(codePoint: number): boolean {
  return (
    (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

export function replaceUnsafeText(value: string): string {
  let result = '';
  for (const char of value) {
    result += isUnsafeTextCodePoint(char.codePointAt(0) ?? 0)
      ? REPLACEMENT_CHARACTER
      : char;
  }
  return result;
}

export function cleanName(value: string): string {
  let result = '';
  for (const char of value) {
    if (char === '\n' || char === '\t') {
      result += ' ';
    } else if (!isUnsafeTextCodePoint(char.codePointAt(0) ?? 0)) {
      result += char;
    }
  }
  return result;
}
