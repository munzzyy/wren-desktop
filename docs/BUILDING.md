<!-- Copyright 2026 Cole Munz -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Building Wren Desktop

## Requirements

- Node 24.21.0, the version in `.nvmrc` and `package.json`.
- pnpm 11.24.0, installed through corepack: `corepack enable`.
- Git, Python 3 (for the helper scripts), and the native build tools for your system.

## Get the code running

```sh
pnpm install
pnpm run generate
pnpm start
```

`pnpm run generate` compiles the protobufs, the TypeScript bundles, the styles and the locale data. Run it again after pulling changes. It also writes the build date that the 90 day expiry counts from.

## Checks

```sh
pnpm run check:types
pnpm run lint-prettier
pnpm run oxlint
pnpm run test-node
pnpm run test-electron
```

On Linux without a display, put `xvfb-run --auto-servernum` in front of the two test commands. On Ubuntu 24.04 Electron also needs `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.

## Linux

Needs `libpulse0` at runtime and the usual compiler toolchain at build time.

```sh
pnpm run generate
pnpm run build:release --publish=never
```

The installers land in `release/`: a `.deb` and an `.AppImage`.

## Windows

Needs Visual Studio Build Tools with the C++ workload and Python. In PowerShell:

```powershell
pnpm install
pnpm run generate
pnpm run build:release --publish=never
```

The output is an NSIS installer `.exe` in `release/`. The build downloads Signal's patched NSIS from updates.signal.org and checks it against the sum in `package.json`.

## macOS

Needs Xcode command line tools.

```sh
pnpm install
pnpm run generate
SKIP_SIGNING_SCRIPT=1 CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run build:release --publish=never
```

The output is a `.dmg` (universal) and per-architecture `.zip` files in `release/`.

The builds from CI are not signed or notarized, because there is no Apple developer certificate behind them. Gatekeeper will refuse a plain double click. See the install section of the README for the workaround.

## Releases

Pushing a tag that starts with `v` runs the release workflow. It builds on all three systems, writes `SHA256SUMS` and `release-notes.md`, and opens a draft release with everything attached. Read the draft, check the notes, and publish it by hand.

Before tagging, run `tools/release-check.sh` on a clean tree.

## Staying current with Signal

See "Keeping up with Signal" in the README. In short: `tools/merge-upstream.sh`, then `tools/release-check.sh`.
