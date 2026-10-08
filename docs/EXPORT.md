<!-- Copyright 2026 Cole Munz -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Exporting a chat

Wren Desktop can export one chat to a folder on your computer. Signal Desktop has no per-chat export at all, so this is new.

Open the chat, click the menu button in the chat header (or press Ctrl+Shift+L, Cmd+Shift+L on a Mac) and pick **Export chat**. Choose a format, decide whether to include media, click **Export** and pick a folder. You can cancel while it runs. If you cancel or something fails, I delete the half-written folder so nothing partial is left behind. When it's done a toast shows up with a button that opens the folder.

## What you get

The export goes into a new folder inside the one you picked, named after the chat and the time of the export, like `Book Club 2026-10-08 1403`. If that name is taken I add `(2)`, `(3)` and so on rather than touching the old one.

```
Book Club 2026-10-08 1403/
  chat.html        (or chat.txt, or chat.json)
  media/
    <message id>-1.jpg
    <message id>-2.mp4
    ...
```

Files in `media/` are named after the message, and the extension comes from the file's type, not from the name the sender gave it. Only types that a browser or file viewer opens as plain data keep a real extension: common image, video and audio formats, PDF, plain text, CSV, zip and Office documents. When the sender's extension matches the type I keep it (`.jpeg` stays `.jpeg`). Everything else, including HTML, SVG, XML and scripts, is saved as `.bin`, so double-clicking a file next to `chat.html` can't run it.

Messages are written oldest first. Every message carries its sender, the time it was sent, the text with mentions written as `@Name`, the quote it replied to, reactions and who sent them, attachments, link previews, whether it was edited, and the disappearing timer if one was set. Group updates, timer changes, safety number changes and other system messages are included as short lines.

Deleted messages show as "This message was deleted." View-once media never leaves the app: those messages show as a placeholder and nothing is copied.

## Formats

### HTML

This is the default. It's one self-contained page that opens in any browser. The styling is inline, there is no JavaScript, and a Content-Security-Policy in the page blocks scripts and anything loaded from the network. Your messages sit on the right and everyone else's on the left. System messages go in the middle. Images show inline and videos and voice notes get players when their type is on the list above; every other file is a plain link into `media/`. Everything that came from a message is escaped, and a link preview only becomes a clickable link when it starts with `http://` or `https://`.

### Plain text

A `.txt` file that reads like a chat log:

```
[2026-10-08 14:05] Alice: Look at this
    > Me: Hello there
    [image] cat.jpg (2.0 KB) -> media/m2-1.jpg
    Reactions: 👍 Bob, 😂 Me
```

Quotes, attachments, links and reactions are indented under the message. Lines of a multi-line message are indented too, so no message text can pass itself off as a new message.

Terminal control characters, and the bidi marks that can reorder a line, are replaced with U+FFFD in the text file, so `cat chat.txt` can't move your cursor, change colors or flip a line around. Tabs and newlines stay. The HTML and JSON files keep message text as it was sent, escaped, but strip the same characters out of names.

### JSON

One object with the chat details and a `messages` array, for scripts and other tools. Every timestamp is there twice: epoch milliseconds (`sentAt`) and ISO 8601 in UTC (`sentAtIso`). Attachments list their status (`exported`, `missing` or `not-included`) and their path inside the export folder.

### Times

Times in the HTML and text files are in your computer's time zone.

## Limits

- **The export is not encrypted.** Anyone who can read the folder can read the chat. Disappearing messages are exported as they are at that moment and will not disappear from the export. Keep the folder somewhere safe and delete it when you're done with it.
- Media comes from what this computer already downloaded. Attachments that were never downloaded, or that failed to download, are skipped and marked as missing in the export. If you want them, open them in the chat first so they download, then export again.
- Stickers are exported as their image.
- I only export what this desktop has. Wren Desktop is a linked device, so it holds what was synced to it. Messages from before you linked it are not on this computer and cannot be exported from here.
- Unchecking **Include media** skips copying files. The messages still list each attachment by name, type and size.
- The export text (placeholders, labels) is in English for now.

## Under the hood

The window reads the chat from the local database 200 messages at a time and turns each page into plain export records. Writing files and decrypting attachments happen in the main process, so the window stays responsive. Attachments are stored encrypted on disk; the export decrypts each one straight into `media/` and never writes the encryption keys anywhere. The code lives in `ts/wren/export/` and `app/wren_export.main.ts`, with tests in `ts/test-node/wren/export/`.
