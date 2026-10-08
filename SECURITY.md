<!-- Copyright 2026 Cole Munz -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Security

If you find a vulnerability in Wren Desktop, email Munzzyy1@proton.me. Do not open a public issue for it.

What to expect: a reply within 7 days, a verdict within about 14 days of that, and a fix or a clear mitigation within 90 days, sooner for anything that exposes messages or breaks the lock. These are targets, not a service level; I am one person. Credit goes in the release notes under the name you pick, and there is no bounty. The Android repo's SECURITY.md spells out the same policy in full, including what counts as a report and the good-faith research line, and it applies here as written. Problems in the Signal protocol or Signal's servers should go to Signal (security@signal.org). Problems in Signal Desktop code that Wren Desktop inherits will be reported upstream too.

Wren Desktop builds are unsigned, so check the SHA-256 sums on the releases page. A build expires about 90 days after its build date, the same as Signal Desktop, and does not update itself. Install new releases when they come out.
