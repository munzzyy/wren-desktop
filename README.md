<!-- Copyright 2026 Cole Munz -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Wren Desktop

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

Wren Desktop is a fork of [Signal Desktop](https://github.com/signalapp/Signal-Desktop). You link it to your phone the same way you link Signal Desktop, as another device on your account. It talks to Signal's servers, so your contacts, groups and calls stay where they are.

It is the desktop sibling of Wren for Android, a fork of Molly. It is built
from Signal Desktop's main branch at 8.33.0-alpha.1, not from a release tag;
the first Wren Desktop release will move to Signal's next stable tag first. Signal Desktop has no app lock, no wipe and no way to export a single chat. Wren Desktop is my attempt at filling those gaps.

## Why Wren Desktop instead of Signal Desktop or Molly

Signal Desktop opens straight into your messages for anyone at your keyboard,
keeps the database key in a config file guarded only by the OS keyring, has
no proxy setting beyond an environment variable, and cannot export a chat.
Signal has turned down an app lock for years. Molly, the hardened Android
client, has no desktop app at all, so Molly users run plain Signal Desktop
next to a locked phone.

Wren Desktop closes that gap:

- A passphrase lock. The database key is wrapped with scrypt and AES-GCM and
  the plain key leaves the config file and the keyring while the lock is on;
  turning the lock on also gives the database a fresh key, so an old copy of
  the config cannot open it.
- Erase under pressure. A duress passphrase and a limit on wrong tries, both
  of which erase the data folder, and a lock that fires on idle, on screen
  lock, on quit, or from the File menu.
- A proxy and Tor setting that refuses to connect any other way. When the
  proxy is down Wren Desktop stays offline instead of leaking a direct
  connection, and the limits of that (calls, GIF search, a race inside
  libsignal) are written down in [docs/PROXY.md](docs/PROXY.md).
- Chat export to HTML, text or JSON with the attachments, from the chat menu.
- The passphrase asked again before an export or before the lock gets weaker.

## What it adds

These are in the code now. They have unit tests, type checks and lint behind them, and they have not yet been through a round of use on real machines by anyone but me, so treat the first release as a beta.

- A passphrase lock. The database key is wrapped with a key derived from your passphrase using scrypt and AES-GCM, and the plain key leaves the config file and the OS keyring while the lock is on. Settings, Privacy, App lock. Lock at any time from the File menu or with Ctrl+Alt+L.
- A duress passphrase. Type it at the lock screen instead of your real one and Wren Desktop erases the database and its keys.
- Wipe after failed attempts. After a set number of wrong passphrases the data is erased.
- Auto-lock after you have been away for a while.
- Export of one chat to HTML, plain text or JSON, with the attachments next to it, from the chat's menu.

Everything else Signal Desktop does, Wren Desktop does, because it is Signal Desktop underneath.

## How it compares

|               | Signal Desktop         | Molly          | Wren Desktop                            |
| ------------- | ---------------------- | -------------- | --------------------------------------- |
| App lock      | no                     | no desktop app | yes                                     |
| Duress wipe   | no                     | no desktop app | yes, plus wipe after failed attempts    |
| Proxy and Tor | env variable only      | no desktop app | setting, fails closed                   |
| Chat export   | JSON of all chats only | no desktop app | one chat: HTML, text or JSON with media |
| Auto update   | yes                    | no desktop app | no, you update from the releases page   |
| Signed builds | yes                    | no desktop app | no                                      |

## Install

There is no release yet. When there is one, the [releases page](https://github.com/munzzyy/wren-desktop/releases) will carry a `.deb` and an `.AppImage` for Linux, an installer `.exe` for Windows, and a `.dmg` and `.zip` for macOS, plus a `SHA256SUMS` file. Check the sum of what you downloaded against it.

The builds are unsigned. I have no code signing certificate and no Apple notarization, so each system complains in its own way.

- Windows: SmartScreen says the publisher is unknown. Choose More info, then Run anyway, once you have checked the sum.
- macOS: Gatekeeper refuses to open it on a double click. Right click the app and choose Open, or allow it under System Settings, Privacy and Security. If macOS says the app is damaged, `xattr -dr com.apple.quarantine /Applications/Wren.app` clears the quarantine flag. I have not been able to test the macOS builds on a real Mac yet.
- Linux: nothing warns you, which is not the same as nothing being wrong. The sum is your only check.

A build stops working about 90 days after it was built, the same as Signal Desktop does. Wren Desktop does not update itself, so watch the releases page and install the next one before the old one expires.

## Linking to your phone

Open Wren Desktop, scan the QR code from your phone under Settings, Linked devices, and you are done. The phone can run Signal, Molly or Wren.

## Build it yourself

You need Node 24.21.0 and pnpm 11.24.0. pnpm comes through corepack.

```sh
corepack enable
pnpm install
pnpm run generate
pnpm start
```

To make installers:

```sh
pnpm run generate
pnpm run build:release --publish=never
```

That builds for the system you run it on. [docs/BUILDING.md](docs/BUILDING.md) has the details for Linux, Windows and macOS.

## Keeping up with Signal

A daily workflow, `sync-upstream`, checks Signal Desktop's newest release tag against the version in `package.json`. When Signal is ahead it opens one issue called "Merge Signal Desktop vX.Y.Z" with the compare link, and it closes the issue once the merge lands.

To do the merge, run `tools/merge-upstream.sh` on a clean checkout. It fetches the tag, merges it, runs `tools/rebrand.py` and commits if there were no conflicts. With conflicts it leaves the merge open and lists them in groups. `tools/rebrand.py` puts the Wren name, package id and settings back after a merge, and `tools/release-check.sh` checks the result before a release.

## Questions people ask

Is this an official Signal app? No. It is not affiliated with Signal Messenger or the Signal Foundation.

Do I need a second phone number? No. It links to your existing account as a device.

Does it change how messages are encrypted? No. None of the additions above touch the Signal protocol code. They work on the data stored on your computer.

Why no auto update? An updater that pulls binaries from my server would be one more thing you have to trust. For now you download releases yourself and check the sums.

Why unsigned? Certificates cost money and an Apple developer account needs one. If that changes I will say so here.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, which is Signal's guide and mostly applies. Run `pnpm run check:types` and `pnpm run lint-prettier` before you open a pull request. Anything that is a bug in Signal Desktop itself is better reported to Signal.

## Security

Report vulnerabilities by email, not in a public issue. See [SECURITY.md](SECURITY.md).

## License

AGPL-3.0-only, inherited from Signal Desktop and not something a fork can loosen. See [LICENSE](LICENSE) and [LEGAL.md](LEGAL.md).

## Thanks

To the Signal team, whose work this is built on, and to the Molly project for showing a fork like this is worth keeping up.
