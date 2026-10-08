// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { count as countGraphemes } from '../../util/grapheme.std.ts';

export type PassphraseStrengthType = 'weak' | 'fair' | 'strong';

export function getPassphraseStrength(
  passphrase: string
): PassphraseStrengthType {
  const length = countGraphemes(passphrase);
  const words = passphrase.trim().split(/\s+/).filter(Boolean).length;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9\s]/].filter(re =>
    re.test(passphrase)
  ).length;

  if (length >= 20 || (words >= 4 && length >= 16)) {
    return 'strong';
  }
  if (length >= 12 || (length >= 10 && classes >= 3)) {
    return 'fair';
  }
  return 'weak';
}
