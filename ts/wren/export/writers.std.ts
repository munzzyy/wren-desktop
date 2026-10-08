// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { missingCaseError } from '../../util/missingCaseError.std.ts';
import type {
  ExportAttachment,
  ExportChat,
  ExportFormat,
  ExportLink,
  ExportMessage,
  ExportQuote,
} from './model.std.ts';
import {
  formatDateTime,
  formatTimer,
  getLocalDateParts,
  toIsoUtc,
  type GetDateParts,
} from './time.std.ts';
import { getMediaKind } from './fileNames.std.ts';
import { cleanName, replaceUnsafeText } from './unsafeText.std.ts';

export type Sink = (chunk: string) => void;

export type ChatWriter = Readonly<{
  writeHeader: (chat: ExportChat) => void;
  writeMessage: (message: ExportMessage) => void;
  writeFooter: () => void;
}>;

export type WriterOptions = Readonly<{
  getDateParts?: GetDateParts;
}>;

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, char => HTML_ESCAPES[char] ?? char);
}

export function getSafeHref(url: string): string | undefined {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.href;
  } catch {
    return undefined;
  }
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function getAttachmentKind(attachment: ExportAttachment): string {
  if (attachment.isVoiceNote) {
    return 'Voice message';
  }
  if (attachment.isSticker) {
    return 'Sticker';
  }
  if (attachment.contentType.startsWith('image/')) {
    return 'Image';
  }
  if (attachment.contentType.startsWith('video/')) {
    return 'Video';
  }
  if (attachment.contentType.startsWith('audio/')) {
    return 'Audio';
  }
  return 'File';
}

function getAttachmentLabel(attachment: ExportAttachment): string {
  return attachment.fileName || getAttachmentKind(attachment);
}

function encodeMediaPath(mediaPath: string): string {
  return mediaPath.split('/').map(encodeURIComponent).join('/');
}

const PLACEHOLDER_DELETED = 'This message was deleted.';
const PLACEHOLDER_VIEW_ONCE = 'View-once media. Not exported.';
const MISSING_ATTACHMENT = 'not on this device';
const NOT_INCLUDED_ATTACHMENT = 'media not included';
const ORIGINAL_MISSING = 'Original message not found';

const HTML_STYLE = `
:root{color-scheme:light dark;--bg:#f6f6f4;--fg:#1b1b1b;--muted:#6b6b6b;--in:#ffffff;--out:#2c6bed;--out-fg:#ffffff;--line:#d9d9d6;--chip:#ececea}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ececec;--muted:#9a9a9a;--in:#262626;--out:#2c58c4;--out-fg:#ffffff;--line:#3a3a3a;--chip:#2e2e2e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{max-width:760px;margin:0 auto;padding:24px 16px 8px}
h1{margin:0 0 4px;font-size:22px}
.sub{color:var(--muted);font-size:13px}
main{max-width:760px;margin:0 auto;padding:8px 16px 40px;display:flex;flex-direction:column;gap:8px}
.msg{display:flex}
.msg.out{justify-content:flex-end}
.bubble{max-width:78%;padding:8px 12px;border-radius:16px;background:var(--in);overflow-wrap:anywhere}
.out .bubble{background:var(--out);color:var(--out-fg)}
.meta{display:flex;gap:8px;align-items:baseline;font-size:12px;opacity:.8;margin-bottom:2px}
.author{font-weight:600}
.body{white-space:pre-wrap}
.placeholder{font-style:italic;opacity:.8}
.system{align-self:center;max-width:90%;text-align:center;color:var(--muted);font-size:13px;padding:4px 8px}
.quote{margin:4px 0 6px;padding:4px 8px;border-left:3px solid currentColor;border-radius:4px;background:rgba(127,127,127,.15);font-size:13px}
.quote-author{font-weight:600}
.quote-text{white-space:pre-wrap}
.reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.reaction{background:var(--chip);color:var(--fg);border-radius:10px;padding:0 6px;font-size:13px}
.att{margin:6px 0}
.att img{display:block;max-width:100%;max-height:360px;border-radius:10px}
.att video{display:block;max-width:100%;max-height:360px;border-radius:10px}
.att audio{display:block;max-width:100%}
.att a{color:inherit}
.missing{opacity:.75;font-style:italic}
.link{margin:6px 0;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font-size:13px}
.link a{color:inherit;font-weight:600}
.link .url{opacity:.8;overflow-wrap:anywhere}
.timer,.edited{font-size:11px;opacity:.75;margin-top:2px}
`;

const HTML_CSP =
  "default-src 'none'; img-src 'self' file:; media-src 'self' file:; " +
  "style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; " +
  "form-action 'none'";

function createHtmlWriter(sink: Sink, getDateParts: GetDateParts): ChatWriter {
  const time = (epochMs: number): string =>
    `<time datetime="${escapeHtml(toIsoUtc(epochMs))}">` +
    `${escapeHtml(formatDateTime(getDateParts(epochMs)))}</time>`;

  const renderQuote = (quote: ExportQuote): string => {
    let html = '<blockquote class="quote">';
    html += `<div class="quote-author">${escapeHtml(quote.authorName)}</div>`;
    if (quote.text) {
      html += `<div class="quote-text">${escapeHtml(quote.text)}</div>`;
    }
    for (const name of quote.attachmentNames) {
      html += `<div class="quote-att">${escapeHtml(name)}</div>`;
    }
    if (quote.isOriginalMissing) {
      html += `<div class="placeholder">${ORIGINAL_MISSING}</div>`;
    }
    return `${html}</blockquote>`;
  };

  const renderAttachment = (attachment: ExportAttachment): string => {
    const label = escapeHtml(getAttachmentLabel(attachment));
    const size = escapeHtml(formatSize(attachment.size));
    if (attachment.status === 'exported' && attachment.mediaPath) {
      const href = escapeHtml(encodeMediaPath(attachment.mediaPath));
      const kind = getMediaKind(attachment.contentType);
      if (kind === 'image') {
        return (
          `<div class="att"><a href="${href}">` +
          `<img src="${href}" alt="${label}" loading="lazy"></a></div>`
        );
      }
      if (kind === 'video') {
        return (
          `<div class="att"><video controls preload="metadata" src="${href}">` +
          `</video><a href="${href}">${label}</a></div>`
        );
      }
      if (kind === 'audio') {
        return (
          `<div class="att"><audio controls preload="none" src="${href}">` +
          `</audio><a href="${href}">${label}</a></div>`
        );
      }
      return `<div class="att"><a href="${href}">${label}</a> (${size})</div>`;
    }
    const reason =
      attachment.status === 'missing'
        ? MISSING_ATTACHMENT
        : NOT_INCLUDED_ATTACHMENT;
    return `<div class="att missing">${label} (${size}, ${reason})</div>`;
  };

  const renderLink = (link: ExportLink): string => {
    const href = getSafeHref(link.url);
    const title = escapeHtml(link.title || link.url);
    let html = '<div class="link">';
    html +=
      href == null
        ? `<div>${title}</div>`
        : `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${title}</a>`;
    if (link.description) {
      html += `<div>${escapeHtml(link.description)}</div>`;
    }
    html += `<div class="url">${escapeHtml(link.url)}</div>`;
    return `${html}</div>`;
  };

  return {
    writeHeader(chat) {
      const name = escapeHtml(chat.name);
      sink(
        '<!doctype html>\n<html lang="en">\n<head>\n' +
          '<meta charset="utf-8">\n' +
          `<meta http-equiv="Content-Security-Policy" content="${HTML_CSP}">\n` +
          '<meta name="referrer" content="no-referrer">\n' +
          '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
          `<title>${name}</title>\n<style>${HTML_STYLE}</style>\n` +
          '</head>\n<body>\n<header>\n' +
          `<h1>${name}</h1>\n` +
          `<div class="sub">Exported from Wren on ${time(chat.exportedAt)}` +
          `${chat.includesMedia ? '' : ', without media'}</div>\n` +
          '</header>\n<main>\n'
      );
    },

    writeMessage(message) {
      const id = escapeHtml(message.id);
      if (message.kind === 'system') {
        sink(
          `<div class="system" id="m-${id}">${escapeHtml(message.body)} ` +
            `&middot; ${time(message.sentAt)}</div>\n`
        );
        return;
      }

      let html = `<div class="msg ${message.isOutgoing ? 'out' : 'in'}" id="m-${id}">`;
      html += '<div class="bubble">';
      html +=
        `<div class="meta"><span class="author">${escapeHtml(message.authorName)}` +
        `</span>${time(message.sentAt)}</div>`;

      if (message.isDeleted) {
        html += `<div class="placeholder">${PLACEHOLDER_DELETED}</div>`;
      } else if (message.isViewOnce) {
        html += `<div class="placeholder">${PLACEHOLDER_VIEW_ONCE}</div>`;
      } else {
        if (message.quote) {
          html += renderQuote(message.quote);
        }
        for (const attachment of message.attachments) {
          html += renderAttachment(attachment);
        }
        if (message.body) {
          html += `<div class="body">${escapeHtml(message.body)}</div>`;
        }
        for (const link of message.links) {
          html += renderLink(link);
        }
      }

      if (message.reactions.length > 0) {
        html += '<div class="reactions">';
        for (const reaction of message.reactions) {
          html +=
            `<span class="reaction" title="${escapeHtml(reaction.fromName)}">` +
            `${escapeHtml(reaction.emoji)}</span>`;
        }
        html += '</div>';
      }
      if (message.isEdited && !message.isDeleted) {
        html += '<div class="edited">Edited</div>';
      }
      if (message.expireTimerSeconds) {
        html +=
          '<div class="timer">Disappears after ' +
          `${escapeHtml(formatTimer(message.expireTimerSeconds))}</div>`;
      }
      sink(`${html}</div></div>\n`);
    },

    writeFooter() {
      sink('</main>\n</body>\n</html>\n');
    },
  };
}

function indentLines(text: string, indent: string): string {
  return text.split('\n').join(`\n${indent}`);
}

function createTextWriter(sink: Sink, getDateParts: GetDateParts): ChatWriter {
  const INDENT = '    ';
  const stamp = (epochMs: number) =>
    `[${formatDateTime(getDateParts(epochMs))}]`;

  const describeAttachment = (attachment: ExportAttachment): string => {
    const kind = getAttachmentKind(attachment).toLowerCase();
    const size = formatSize(attachment.size);
    const name = attachment.fileName ? `${attachment.fileName} ` : '';
    let where: string;
    if (attachment.status === 'exported' && attachment.mediaPath) {
      where = ` -> ${attachment.mediaPath}`;
    } else if (attachment.status === 'missing') {
      where = ` (${MISSING_ATTACHMENT})`;
    } else {
      where = ` (${NOT_INCLUDED_ATTACHMENT})`;
    }
    return `[${kind}] ${name}(${size})${where}`;
  };

  return {
    writeHeader(chat) {
      sink(
        `Chat: ${chat.name}\n` +
          `Exported from Wren: ${formatDateTime(getDateParts(chat.exportedAt))}\n` +
          `Media: ${chat.includesMedia ? 'included' : 'not included'}\n\n`
      );
    },

    writeMessage(message) {
      const prefix = stamp(message.sentAt);
      if (message.kind === 'system') {
        sink(`${prefix} * ${indentLines(message.body, INDENT)}\n\n`);
        return;
      }

      let body: string;
      if (message.isDeleted) {
        body = `(${PLACEHOLDER_DELETED})`;
      } else if (message.isViewOnce) {
        body = `(${PLACEHOLDER_VIEW_ONCE})`;
      } else {
        body = indentLines(message.body, INDENT);
      }

      const lines = [`${prefix} ${message.authorName}: ${body}`.trimEnd()];
      if (!message.isDeleted && !message.isViewOnce) {
        if (message.quote) {
          const { quote } = message;
          const quoteText = quote.text
            ? ` ${indentLines(quote.text, `${INDENT}> `)}`
            : '';
          lines.push(`${INDENT}> ${quote.authorName}:${quoteText}`);
          for (const name of quote.attachmentNames) {
            lines.push(`${INDENT}> [${name}]`);
          }
          if (quote.isOriginalMissing) {
            lines.push(`${INDENT}> (${ORIGINAL_MISSING})`);
          }
        }
        for (const attachment of message.attachments) {
          lines.push(`${INDENT}${describeAttachment(attachment)}`);
        }
        for (const link of message.links) {
          const title = link.title ? ` ${link.title}` : '';
          lines.push(`${INDENT}[link] ${link.url}${title}`);
        }
      }
      if (message.reactions.length > 0) {
        const reactions = message.reactions
          .map(reaction => `${reaction.emoji} ${reaction.fromName}`)
          .join(', ');
        lines.push(`${INDENT}Reactions: ${reactions}`);
      }
      if (message.isEdited && !message.isDeleted) {
        lines.push(`${INDENT}(edited)`);
      }
      if (message.expireTimerSeconds) {
        lines.push(
          `${INDENT}(disappears after ${formatTimer(message.expireTimerSeconds)})`
        );
      }
      sink(`${lines.join('\n')}\n\n`);
    },

    writeFooter() {
      // Plain text needs no closing marker.
    },
  };
}

function toJsonAttachment(attachment: ExportAttachment) {
  return {
    fileName: attachment.fileName ?? null,
    contentType: attachment.contentType,
    size: attachment.size,
    voiceNote: attachment.isVoiceNote,
    sticker: attachment.isSticker,
    status: attachment.status,
    path:
      attachment.status === 'exported' && attachment.mediaPath
        ? attachment.mediaPath
        : null,
  };
}

function toJsonMessage(message: ExportMessage) {
  return {
    id: message.id,
    kind: message.kind,
    sentAt: message.sentAt,
    sentAtIso: toIsoUtc(message.sentAt),
    receivedAt: message.receivedAt,
    receivedAtIso: toIsoUtc(message.receivedAt),
    author: message.authorName,
    outgoing: message.isOutgoing,
    body: message.body,
    deleted: message.isDeleted,
    viewOnce: message.isViewOnce,
    edited: message.isEdited,
    expireTimerSeconds: message.expireTimerSeconds ?? null,
    quote: message.quote
      ? {
          author: message.quote.authorName,
          text: message.quote.text,
          attachments: message.quote.attachmentNames,
          originalMissing: message.quote.isOriginalMissing,
        }
      : null,
    reactions: message.reactions.map(reaction => ({
      emoji: reaction.emoji,
      from: reaction.fromName,
      timestamp: reaction.timestamp,
      timestampIso: toIsoUtc(reaction.timestamp),
    })),
    attachments: message.attachments.map(toJsonAttachment),
    links: message.links.map(link => ({
      url: link.url,
      title: link.title ?? null,
      description: link.description ?? null,
      domain: link.domain ?? null,
    })),
  };
}

function createJsonWriter(sink: Sink): ChatWriter {
  let count = 0;
  return {
    writeHeader(chat) {
      const header = {
        id: chat.id,
        name: chat.name,
        type: chat.type,
        exportedAt: chat.exportedAt,
        exportedAtIso: toIsoUtc(chat.exportedAt),
        includesMedia: chat.includesMedia,
      };
      sink(
        '{\n  "format": "wren-chat-export",\n  "version": 1,\n' +
          `  "chat": ${JSON.stringify(header)},\n  "messages": [`
      );
    },

    writeMessage(message) {
      sink(
        `${count === 0 ? '\n' : ',\n'}    ${JSON.stringify(toJsonMessage(message))}`
      );
      count += 1;
    },

    writeFooter() {
      sink(`${count === 0 ? '' : '\n  '}]\n}\n`);
    },
  };
}

function cleanMessageNames(message: ExportMessage): ExportMessage {
  return {
    ...message,
    authorName: cleanName(message.authorName),
    quote: message.quote && {
      ...message.quote,
      authorName: cleanName(message.quote.authorName),
      attachmentNames: message.quote.attachmentNames.map(cleanName),
    },
    reactions: message.reactions.map(reaction => ({
      ...reaction,
      emoji: cleanName(reaction.emoji),
      fromName: cleanName(reaction.fromName),
    })),
    attachments: message.attachments.map(attachment => ({
      ...attachment,
      fileName:
        attachment.fileName == null
          ? undefined
          : cleanName(attachment.fileName),
    })),
  };
}

function cleanMessageText(message: ExportMessage): ExportMessage {
  return {
    ...message,
    body: replaceUnsafeText(message.body),
    quote: message.quote && {
      ...message.quote,
      text: replaceUnsafeText(message.quote.text),
    },
    links: message.links.map(link => ({
      ...link,
      url: replaceUnsafeText(link.url),
      title: link.title == null ? undefined : replaceUnsafeText(link.title),
    })),
  };
}

function cleaningWriter(
  writer: ChatWriter,
  cleanMessage: (message: ExportMessage) => ExportMessage
): ChatWriter {
  return {
    writeHeader: chat =>
      writer.writeHeader({ ...chat, name: cleanName(chat.name) }),
    writeMessage: message => writer.writeMessage(cleanMessage(message)),
    writeFooter: () => writer.writeFooter(),
  };
}

export function createChatWriter(
  format: ExportFormat,
  sink: Sink,
  { getDateParts = getLocalDateParts }: WriterOptions = {}
): ChatWriter {
  switch (format) {
    case 'html':
      return cleaningWriter(
        createHtmlWriter(sink, getDateParts),
        cleanMessageNames
      );
    case 'text':
      // chat.txt gets read in terminals, where escapes and bidi overrides act.
      return cleaningWriter(createTextWriter(sink, getDateParts), message =>
        cleanMessageText(cleanMessageNames(message))
      );
    case 'json':
      return cleaningWriter(createJsonWriter(sink), cleanMessageNames);
    default:
      throw missingCaseError(format);
  }
}
