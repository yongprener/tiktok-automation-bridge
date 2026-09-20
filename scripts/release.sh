#!/usr/bin/env bash
# ==========================================
# Release helper — bump version, tag, push
# ==========================================
# Usage:
#   ./scripts/release.sh patch    # 0.2.1 -> 0.2.2
#   ./scripts/release.sh minor    # 0.2.1 -> 0.3.0
#   ./scripts/release.sh major    # 0.2.1 -> 1.0.0
#   ./scripts/release.sh 0.4.2    # explicit version
#
# Keeps the version string identical across manifest.json, background.js,
# popup.js. That consistency is enforced by tests/run.sh — if they drift, the
# popup shows a permanent "stale service worker" banner.

set -euo pipefail

cd "$(dirname "$0")/.."

MANIFEST="chrome-extension/manifest.json"
BG="chrome-extension/background.js"
POPUP="chrome-extension/popup.js"
CHANGELOG="CHANGELOG.md"

BUMP="${1:-patch}"

CURRENT=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['version'])")
echo "Current version: $CURRENT"

NEW=$(python3 - "$CURRENT" "$BUMP" <<'PY'
import sys, re
cur, bump = sys.argv[1], sys.argv[2]
if re.fullmatch(r'\d+\.\d+\.\d+', bump):
    print(bump); raise SystemExit
major, minor, patch = (int(x) for x in cur.split('.'))
if bump == 'major':   major, minor, patch = major + 1, 0, 0
elif bump == 'minor': minor, patch = minor + 1, 0
elif bump == 'patch': patch += 1
else:
    sys.exit(f"unknown bump type: {bump}")
print(f"{major}.{minor}.{patch}")
PY
)

echo "New version:     $NEW"

if git rev-parse "v$NEW" >/dev/null 2>&1; then
  echo "ERROR: tag v$NEW already exists."
  exit 1
fi

# ── Apply the version everywhere ─────────────────────────────────
python3 - "$NEW" "$MANIFEST" "$BG" "$POPUP" <<'PY'
import json, re, sys
new, manifest, bg, popup = sys.argv[1:5]

m = json.load(open(manifest))
m['version'] = new
with open(manifest, 'w') as f:
    json.dump(m, f, indent=2, ensure_ascii=False)
    f.write('\n')

for path, pattern in ((bg, r"CURRENT_VERSION"), (popup, r"EXPECTED_VERSION")):
    s = open(path, encoding='utf-8').read()
    s2, n = re.subn(rf"({pattern}\s*=\s*')[^']+(')", rf"\g<1>{new}\g<2>", s)
    assert n == 1, f"{path}: expected 1 match for {pattern}, got {n}"
    open(path, 'w', encoding='utf-8').write(s2)

print(f"  updated {manifest}, {bg}, {popup}")
PY

# ── CHANGELOG ────────────────────────────────────────────────────
if [ ! -f "$CHANGELOG" ]; then
  printf '# Changelog\n\nSemua perubahan penting project ini.\nFormat: [Keep a Changelog](https://keepachangelog.com/).\n\n' > "$CHANGELOG"
fi

DATE=$(date -u +%Y-%m-%d)
python3 - "$CHANGELOG" "$NEW" "$DATE" <<'PY'
import sys
path, version, date = sys.argv[1:4]
lines = open(path, encoding='utf-8').read().split('\n')

# insert a fresh section right after the intro block (first blank-separated header)
marker = None
for i, l in enumerate(lines):
    if l.startswith('## '):
        marker = i
        break

section = [f'## [{version}] - {date}', '', '### Changed', '', '- (tulis perubahan di sini sebelum commit)', '']
if marker is None:
    lines = lines + section
else:
    lines = lines[:marker] + section + lines[marker:]

open(path, 'w', encoding='utf-8').write('\n'.join(lines))
print(f'  changelog section added for {version}')
PY

# ── Verify before committing ─────────────────────────────────────
echo
echo "── verifying version consistency ──────────"
./tests/run.sh > /tmp/release-tests.log 2>&1 || {
  echo "TESTS FAILED — aborting release. See /tmp/release-tests.log"
  tail -30 /tmp/release-tests.log
  git checkout -- "$MANIFEST" "$BG" "$POPUP" "$CHANGELOG" 2>/dev/null || true
  exit 1
}
grep -E 'version consistent|ALL SUITES PASSED' /tmp/release-tests.log || true

# ── Commit + tag + push ──────────────────────────────────────────
echo
git add "$MANIFEST" "$BG" "$POPUP" "$CHANGELOG"
git commit -q -m "chore(release): v$NEW"
git tag -a "v$NEW" -m "v$NEW"
git push -q origin main
git push -q origin "v$NEW"

echo
echo "=========================================="
echo "  Released v$NEW"
echo "=========================================="
echo ""
echo "Next: edit CHANGELOG.md to describe the release,"
echo "then 'git commit -am \"docs: changelog v$NEW\" && git push'."
