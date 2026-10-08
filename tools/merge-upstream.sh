#!/usr/bin/env bash
# Copyright 2026 Cole Munz
# SPDX-License-Identifier: AGPL-3.0-only
#
# Merge a Signal Desktop release tag into the current branch and re-apply the Wren rebrand.
# Usage: tools/merge-upstream.sh [TAG]    (default: newest release tag)
set -euo pipefail

SIGNAL_URL=https://github.com/signalapp/Signal-Desktop.git

die() {
  echo "error: $*" >&2
  exit 2
}

root=$(git rev-parse --show-toplevel)
cd "$root"

[[ -f "$(git rev-parse --git-path MERGE_HEAD)" ]] && die "a merge is already in progress"
[[ -z $(git status --porcelain) ]] || die "working tree is not clean, commit or stash first"

if ! git remote get-url signal > /dev/null 2>&1; then
  echo "adding remote signal -> $SIGNAL_URL"
  git remote add signal "$SIGNAL_URL"
fi

tag=${1:-}
if [[ -z $tag ]]; then
  tag=$(git ls-remote --tags --refs signal 'v*' | python3 tools/latest-signal-tag.py) \
    || die "could not work out the newest release tag"
fi
[[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "not a release tag: $tag"

ref=refs/signal-tags/$tag
git fetch --no-tags signal "+refs/tags/$tag:$ref"
target=$(git rev-parse --short=12 "$ref^{commit}")

if git merge-base --is-ancestor "$ref^{commit}" HEAD; then
  echo "already contains Signal Desktop $tag ($target)"
  exit 0
fi

echo "merging Signal Desktop $tag ($target) into $(git branch --show-current)"
merge_rc=0
git merge --no-commit --no-ff "$ref^{commit}" || merge_rc=$?

rebrand_rc=0
python3 tools/rebrand.py || rebrand_rc=$?

if [[ $merge_rc -eq 0 ]]; then
  if [[ $rebrand_rc -ne 0 ]]; then
    echo "merged cleanly but tools/rebrand.py failed, fix it and commit by hand" >&2
    exit 1
  fi
  git add -A
  git commit -q -m "Merge Signal Desktop $tag"
  echo "merged cleanly and committed: $(git rev-parse --short HEAD)"
  exit 0
fi

locales=()
app=()
other=()
while IFS= read -r path; do
  case $path in
    _locales/*) locales+=("$path") ;;
    ts/* | app/*) app+=("$path") ;;
    *) other+=("$path") ;;
  esac
done < <(git diff --name-only --diff-filter=U)

print_group() {
  local title=$1
  shift
  echo
  echo "$title ($#)"
  for path in "$@"; do
    echo "  $path"
  done
}

echo
echo "conflicts merging Signal Desktop $tag ($target):"
print_group "locales" "${locales[@]}"
print_group "ts-app" "${app[@]}"
print_group "other" "${other[@]}"

if [[ $rebrand_rc -ne 0 ]]; then
  echo
  echo "tools/rebrand.py could not run, most likely because package.json still has conflict markers."
fi

cat <<'EOF'

The merge is left uncommitted. To finish:
  1. Fix each file above. For locales keep Signal's side, rebrand fixes the name.
     package.json: keep Signal's version and dependencies, rebrand sets the Wren fields.
  2. python3 tools/rebrand.py
  3. tools/release-check.sh after committing
  4. git add -A && git commit
To back out: git merge --abort
EOF
exit 1
