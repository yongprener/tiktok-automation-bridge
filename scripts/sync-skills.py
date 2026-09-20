#!/usr/bin/env python3
"""
Generate chrome-extension/lib/skills-bundled.js from skills/bundled.json.

Chrome MV3 service workers cannot fetch() their own packaged files, and
importScripts() only accepts JavaScript. So the bundled skill definitions are
inlined into a JS file. Run this after editing skills/bundled.json —
tests/run.sh fails if the two are out of sync.
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "chrome-extension" / "skills" / "bundled.json"
OUT = ROOT / "chrome-extension" / "lib" / "skills-bundled.js"

HEADER = """/**
 * GENERATED FILE — do not edit by hand.
 * Source: chrome-extension/skills/bundled.json
 * Regenerate: python3 scripts/sync-skills.py
 */

const BUNDLED_SKILLS = """

FOOTER = """;
"""


def main() -> int:
    try:
        raw = SRC.read_text(encoding="utf-8")
    except FileNotFoundError:
        print(f"ERROR: {SRC} not found", file=sys.stderr)
        return 1

    try:
        skills = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"ERROR: {SRC} is not valid JSON: {e}", file=sys.stderr)
        return 1

    if not isinstance(skills, list):
        print(f"ERROR: {SRC} must contain a JSON array", file=sys.stderr)
        return 1

    # Sanity check every skill up front so a typo never reaches the extension.
    KNOWN = {"navigate", "waitFor", "wait", "click", "fill", "scroll",
             "collect", "assert", "screenshot", "report"}
    seen = set()
    for s in skills:
        sid = s.get("id")
        if not sid:
            print("ERROR: skill without an id", file=sys.stderr)
            return 1
        if sid in seen:
            print(f"ERROR: duplicate skill id: {sid}", file=sys.stderr)
            return 1
        seen.add(sid)
        if not s.get("steps"):
            print(f"ERROR: skill {sid} has no steps", file=sys.stderr)
            return 1
        for i, step in enumerate(s["steps"]):
            act = step.get("action")
            if act not in KNOWN:
                print(f"ERROR: skill {sid} step {i}: unknown action {act!r}", file=sys.stderr)
                return 1

    body = json.dumps(skills, indent=2, ensure_ascii=False)
    expected = HEADER + body + FOOTER

    if "--check" in sys.argv:
        actual = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if actual != expected:
            print(f"  !! {OUT.relative_to(ROOT)} is out of date — run: python3 scripts/sync-skills.py", file=sys.stderr)
            return 1
        print(f"  ok  skills-bundled.js in sync ({len(skills)} skills)")
        return 0

    OUT.write_text(expected, encoding="utf-8")

    print(f"  wrote {OUT.relative_to(ROOT)} — {len(skills)} skills, {len(expected)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
