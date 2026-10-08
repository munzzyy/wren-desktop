<!-- Copyright 2026 Cole Munz -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog

## Unreleased

Forked from Signal Desktop 8.33.0-alpha.1.

Done:

- Rebranded as Wren Desktop: package id io.github.munzzyy.wren-desktop, new icon, "Signal Desktop" reads "Wren Desktop" in every locale, updates off.
- CI, release and upstream tracking workflows, with `tools/merge-upstream.sh` and `tools/release-check.sh`.
- AppImage added to the Linux build targets.

Planned for the first release, not merged yet:

- A passphrase lock with the database key wrapped by scrypt.
- Duress passphrase that erases the data.
- Wipe after a set number of wrong passphrase attempts.
- Auto-lock after inactivity.
- Export of one chat to HTML, plain text or JSON.
