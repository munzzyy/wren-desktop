#!/usr/bin/env python3
# Copyright 2026 Cole Munz
# SPDX-License-Identifier: AGPL-3.0-only
"""Print the newest Signal Desktop release tag from ls-remote output on stdin.

Usage: <ls-remote --tags --refs output> | tools/latest-signal-tag.py [--current VERSION]

With --current, exits 3 when the newest tag is not newer than VERSION.
"""
import re
import sys

TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$")


def key(version):
    match = TAG.match(version if version.startswith("v") else "v" + version)
    if not match:
        return None
    major, minor, patch, pre = match.groups()
    if pre is None:
        pre_key = (1,)
    else:
        parts = [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in pre.split(".")]
        pre_key = (0, tuple(parts))
    return (int(major), int(minor), int(patch), pre_key)


def main(argv):
    current = None
    if "--current" in argv:
        current = argv[argv.index("--current") + 1]
    tags = []
    for line in sys.stdin:
        if not line.strip():
            continue
        name = line.split()[-1].removeprefix("refs/tags/")
        if key(name):
            tags.append(name)
    if not tags:
        print("no release tags on stdin", file=sys.stderr)
        return 2
    newest = max(tags, key=key)
    print(newest)
    if current is not None and key(newest) <= key(current):
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
