<!-- Copyright 2026 Cole Munz -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog

## 0.1.0 (2026-10-08)

Forked from Signal Desktop's main branch at 8.33.0-alpha.1 (an unreleased snapshot; the first release rebases onto Signal's next stable tag).

Done:

- Rebranded as Wren Desktop: package id io.github.munzzyy.wren-desktop, new icon, "Signal Desktop" reads "Wren Desktop" in every locale, updates off.
- CI, release and upstream tracking workflows, with `tools/merge-upstream.sh` and `tools/release-check.sh`.
- AppImage added to the Linux build targets.
- A passphrase lock: the database key is wrapped with scrypt and AES-GCM and the plain key leaves config.json and the OS keyring while the lock is on. Settings, Privacy, App lock. Lock from the File menu or Ctrl+Alt+L.
- Duress passphrase that erases the data directory, and wipe after 5, 10 or 20 wrong attempts.
- Auto-lock after idle time and when the computer locks.
- Export one chat to HTML, plain text or JSON with its attachments, from the chat menu.
