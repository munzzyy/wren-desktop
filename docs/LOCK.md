<!-- Copyright 2026 Cole Munz -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Passphrase lock

Signal Desktop opens straight into your messages for anyone who sits down at your computer. Signal Desktop does not have one. Wren Desktop has one.

Turn it on in Settings, Privacy, App lock. From then on Wren asks for your passphrase every time it starts, and the message database stays closed until you type it.

## How the key is wrapped

Your messages live in a SQLCipher database. Signal Desktop keeps that database key in `config.json` in the data folder, encrypted with your system keychain (Keychain on macOS, DPAPI on Windows, Secret Service or KWallet on Linux) through Electron's `safeStorage`, or in plain text when no keychain is around.

When you set a passphrase I take that key out of the keychain path and wrap it with your passphrase instead:

- scrypt turns the passphrase into a 32 byte key, with N = 2^17, r = 8, p = 1 and a fresh random 16 byte salt. That costs about half a second and 128 MiB of memory per guess, on purpose.
- AES-256-GCM with a fresh random 12 byte nonce encrypts the database key under it. The GCM tag means a wrong passphrase fails cleanly instead of producing a bad key.
- The salt, the nonce and the wrapped key go into a `wrenLock` entry in `config.json`. The old `encryptedKey` and `key` entries are removed after Wren has checked that the new wrapped key opens.

At startup Wren sees `wrenLock`, does not touch the database key and does not open the main window. It opens a small lock window instead. Once the passphrase unwraps the key, the key is held only in memory and startup carries on as normal. While the lock is on, the key is never written back to disk.

Changing the passphrase asks for the current one and rewraps the same database key with a new salt and nonce. Turning the lock off asks for the passphrase and hands the key back to the keychain through the same code path Signal Desktop uses.

## Duress passphrase

You can set a second passphrase. Typing it on the lock screen erases everything Wren keeps on this computer at once, with no question asked. The lock screen does not tell anyone what happened, Wren just closes.

Wren stores only a salted check for it: the SHA-256 of a scrypt output with its own salt, compared in constant time. It can't be the same as your real passphrase, and Wren refuses a new real passphrase that matches it.

## Wipe after failed attempts

Off, 5, 10 or 20. Each wrong passphrase on the lock screen is counted in `config.json` before the lock screen hears back, so killing the app between tries doesn't reset it. When the count reaches your limit, Wren erases its data. A correct passphrase resets the count. The lock screen says how many tries are left when the limit is on.

Erasing means: close the database if it is open, delete the whole Wren data folder (database, attachments, config, logs, everything), then quit. The next start is a fresh install that needs linking again.

## Locking

- Lock Wren in the File menu, or Ctrl+Alt+L (Cmd+Option+L on macOS). Ctrl+Shift+L was the first pick, but Signal already uses it to open the conversation menu.
- Lock now in Settings.
- Lock automatically after 5, 15, 30 or 60 minutes with no keyboard or mouse input on the computer.
- Lock when the computer locks or goes to sleep.

Locking restarts Wren, so the database handle and the key leave memory with the old process and the lock window is what comes back.

## What this does not protect against

I want to be straight about the limits.

- Another account on the same computer that can read your files. They can copy the data folder and try passphrases offline. scrypt slows that down; a weak passphrase still falls. The failed attempt counter only works on the lock screen, not against a copy.
- Malware running as you. If something can read your memory or log your keys while Wren is unlocked, the passphrase and the key are exposed.
- A copy of the data folder taken before you turned the lock on, or any time it was off, including old backups. That copy still has the keychain wrapped key.
- Files outside the database. Logs, `ephemeral.json` and some caches are not encrypted with the database key. Signal Desktop redacts its logs, but they still show when you used the app.
- Swap, hibernation and crash dump files. The key sits in memory while Wren is unlocked, and the OS can write memory to disk. Encrypt your disk.
- Free blocks on the disk. Removing the old `encryptedKey` entry rewrites `config.json`, but an SSD or a journaling filesystem can keep the old bytes for a while. Full disk encryption covers this too.
- The keychain when the lock is off. Then anyone who can log in as you can open Wren, same as Signal Desktop.
- Wiping is a normal delete. It removes the files and the key; it does not overwrite the disk. Without the key the database is unreadable, which is the point.
- Your phone. The lock covers this computer only. The messages that synced to your phone, and the phone's own linked device list, are untouched. Unlink this computer from the phone if it is lost.
- Forgetting the passphrase. There is no recovery. Delete the data folder and link again; the phone still has your messages.
