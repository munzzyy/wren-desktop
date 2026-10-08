#!/usr/bin/env bash
# Copyright 2026 Cole Munz
# SPDX-License-Identifier: AGPL-3.0-only
#
# Local pre-release gate. Prints one line per failure and exits non-zero.
# Usage: tools/release-check.sh
set -uo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root" || exit 2

failures=0
fail() {
  echo "FAIL: $*"
  failures=$((failures + 1))
}

while IFS='=' read -r field want; do
  got=$(python3 - "$field" << 'PY'
import json
import sys

data = json.load(open("package.json", encoding="utf-8"))
node = data
for part in sys.argv[1].split("."):
    node = node.get(part) if isinstance(node, dict) else None
print(node)
PY
  )
  [[ $got == "$want" ]] || fail "package.json $field is '$got', want '$want'"
done << 'EOF'
name=wren-desktop
productName=Wren
build.appId=io.github.munzzyy.wren-desktop
build.linux.executableName=wren-desktop
EOF

if ! python3 tools/rebrand.py --check > /dev/null 2>&1; then
  fail "tools/rebrand.py --check reports files that are not rebranded"
fi

if hits=$(LC_ALL=C grep -rln --include=messages.json 'Signal Desktop' _locales 2> /dev/null) && [[ -n $hits ]]; then
  while IFS= read -r line; do
    fail "Signal Desktop still in $line"
  done <<< "$hits"
fi

# en dash and em dash as raw bytes, so this file stays ASCII
dash=$'\xe2\x80\x93\|\xe2\x80\x94'
targets=()
for t in README.md SECURITY.md LEGAL.md CHANGELOG.md docs .github/workflows; do
  [[ -e $t ]] && targets+=("$t")
done
if hits=$(LC_ALL=C grep -rn -- "$dash" "${targets[@]}" 2> /dev/null) && [[ -n $hits ]]; then
  while IFS= read -r line; do
    fail "dash character: ${line:0:160}"
  done <<< "$hits"
fi

if [[ -n $(git status --porcelain) ]]; then
  fail "git tree is not clean"
fi

if [[ $failures -gt 0 ]]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "release check passed"
