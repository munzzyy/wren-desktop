#!/usr/bin/env python3
"""Turn a Signal Desktop checkout into Wren Desktop after a merge.

Product name, package id and update settings live in package.json and
config/, and every locale spells "Signal Desktop" out; this rewrites those
and leaves the word Signal alone where it means the network.

Usage: tools/rebrand.py [--check]
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
NAME = "Wren"
PHRASE = re.compile(r"Signal Desktop")


def rewrite_package(check):
    path = ROOT / "package.json"
    text = path.read_text(encoding="utf-8")
    data = json.loads(text)
    before = json.dumps(data, sort_keys=True)
    data["name"] = "wren-desktop"
    data["productName"] = NAME
    data["description"] = "Signal messaging from your desktop, with a passphrase lock"
    data["repository"] = "https://github.com/munzzyy/wren-desktop.git"
    data["homepage"] = "https://github.com/munzzyy/wren-desktop"
    data["author"] = {"name": "Cole Munz", "email": "Munzzyy1@proton.me"}
    build = data["build"]
    build["appId"] = "io.github.munzzyy.wren-desktop"
    for target in ("mac", "win", "linux"):
        build.get(target, {}).pop("publish", None)
    build["win"].pop("signtoolOptions", None)
    build["mac"]["icon"] = "build/icons/png/1024x1024.png"
    build["linux"]["executableName"] = "wren-desktop"
    build["linux"]["desktop"] = {"entry": {"StartupWMClass": "wren"}}
    changed = json.dumps(data, sort_keys=True) != before
    if changed and not check:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return changed


def rewrite_updates(check):
    path = ROOT / "config" / "production.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("updatesEnabled") is False:
        return False
    data["updatesEnabled"] = False
    if not check:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return True


def rewrite_locales(check):
    changed = 0
    for path in sorted((ROOT / "_locales").glob("*/messages.json")):
        before = path.read_text(encoding="utf-8")
        after = PHRASE.sub(f"{NAME} Desktop", before)
        if before != after:
            changed += 1
            if not check:
                path.write_text(after, encoding="utf-8")
    return changed


def main(argv):
    check = "--check" in argv
    pending = []
    if rewrite_package(check):
        pending.append("package.json")
    if rewrite_updates(check):
        pending.append("config/production.json")
    locales = rewrite_locales(check)
    if locales:
        pending.append(f"{locales} locale file(s)")
    if check and pending:
        print("needs rebrand: " + ", ".join(pending), file=sys.stderr)
        return 1
    print(("would change: " if check else "rewrote: ") + (", ".join(pending) or "nothing"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
