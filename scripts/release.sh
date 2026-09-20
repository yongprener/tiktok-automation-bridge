#!/usr/bin/env bash
# ==========================================
# Release helper — bump, changelog, test, tag, publish
# ==========================================
# Usage:
#   ./scripts/release.sh patch    # 0.2.1 -> 0.2.2
#   ./scripts/release.sh minor    # 0.2.1 -> 0.3.0
#   ./scripts/release.sh major    # 0.2.1 -> 1.0.0
#   ./scripts/release.sh 0.4.2    # explicit version
#
# Flow:
#   1. bump version in manifest.json (single source of truth)
#   2. open a CHANGELOG section and let you fill it in
#   3. run the full test suite  (abort + rollback on failure)
#   4. commit, tag vX.Y.Z, push branch + tag
#   5. publish a GitHub Release from the CHANGELOG entry
#
# Step 5 matters: the extension detects updates via the GitHub Releases API,
# so a bare git tag is invisible to it. A tag with no Release = no update
# notification, forever.
#
# Auth: uses $GITHUB_TOKEN, or falls back to ~/.git-credentials.

set -euo pipefail

cd "$(dirname "$0")/.."

MANIFEST="chrome-extension/manifest.json"
BG="chrome-extension/background.js"
POPUP="chrome-extension/popup.js"
CHANGELOG="CHANGELOG.md"
REPO="yongprener/tiktok-automation-bridge"

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

# ── 1. Apply the version ─────────────────────────────────────────
python3 - "$NEW" "$MANIFEST" "$BG" "$POPUP" <<'PY'
import json, re, sys
new, manifest, bg, popup = sys.argv[1:5]

m = json.load(open(manifest))
m['version'] = new
with open(manifest, 'w') as f:
    json.dump(m, f, indent=2, ensure_ascii=False)
    f.write('\n')

# background.js / popup.js deliberately do NOT carry a version literal — they
# read chrome.runtime.getManifest().version. Assert that, so a future edit
# that reintroduces a hardcoded copy fails loudly here.
for path in (bg, popup):
    src = open(path, encoding='utf-8').read()
    assert 'chrome.runtime.getManifest().version' in src, \
        f"{path}: must derive version from the manifest"
    assert not re.search(r"(?:CURRENT_VERSION|EXPECTED_VERSION)\s*=\s*'", src), \
        f"{path}: hardcoded version literal found"

print(f"  manifest.json -> {new} (JS files read it at runtime)")
PY

# ── 2. CHANGELOG ─────────────────────────────────────────────────
if [ ! -f "$CHANGELOG" ]; then
  printf '# Changelog\n\nSemua perubahan penting project ini.\nFormat: [Keep a Changelog](https://keepachangelog.com/).\n\n' > "$CHANGELOG"
fi

DATE=$(date -u +%Y-%m-%d)
python3 - "$CHANGELOG" "$NEW" "$DATE" <<'PY'
import sys, re
path, version, date = sys.argv[1:4]
text = open(path, encoding='utf-8').read()

# If the author already wrote a section for this version, RESPECT it — do not
# insert a placeholder on top. This lets you write the notes first, commit them,
# then run release.sh and have the real notes become the GitHub Release body.
if re.search(rf'^## \[{re.escape(version)}\]', text, re.M):
    print(f'  changelog section for {version} already exists — keeping it')
    raise SystemExit

lines = text.split('\n')
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

# Give the author a chance to write the entries before the release is cut.
if [ -t 0 ]; then
  echo
  read -r -p "Edit CHANGELOG.md now? Press Enter to continue, Ctrl-C to abort and edit by hand... " _ || true
fi

# ── 3. Verify ────────────────────────────────────────────────────
echo
echo "── running full test suite ────────────────"
if ! ./tests/run.sh > /tmp/release-tests.log 2>&1; then
  echo "TESTS FAILED — aborting release. See /tmp/release-tests.log"
  tail -30 /tmp/release-tests.log
  git checkout -- "$MANIFEST" "$BG" "$POPUP" "$CHANGELOG" 2>/dev/null || true
  exit 1
fi
grep -E '═+ [0-9]+ passed|ALL SUITES PASSED' /tmp/release-tests.log || true

# ── 4. Commit, tag, push ─────────────────────────────────────────
echo
git add "$MANIFEST" "$BG" "$POPUP" "$CHANGELOG"
git commit -q -m "chore(release): v$NEW"
git tag -a "v$NEW" -m "v$NEW"
git push -q origin main
git push -q origin "v$NEW"
echo "  committed + tagged + pushed v$NEW"

# ── 5. Publish the GitHub Release ────────────────────────────────
# Without this the extension cannot see the new version.
TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/.git-credentials" ]; then
  TOKEN=$(sed -n 's|^https://[^:]*:\([^@]*\)@github\.com$|\1|p' "$HOME/.git-credentials" | head -1)
fi

if [ -z "$TOKEN" ]; then
  echo
  echo "WARNING: no GitHub token found (set GITHUB_TOKEN or ~/.git-credentials)."
  echo "         The tag was pushed, but NO Release was published."
  echo "         The extension detects updates via the Releases API, so it will"
  echo "         NOT see v$NEW until a Release exists for the tag."
  exit 0
fi

BODY=$(python3 - "$CHANGELOG" "$NEW" <<'PY'
import sys, re
path, version = sys.argv[1:3]
text = open(path, encoding='utf-8').read()
# grab this version's section
m = re.search(rf'^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## |\Z)', text, re.M | re.S)
print((m.group(1).strip() if m else f'Release v{version}'))
PY
)

JSON=$(python3 - "$NEW" "$BODY" <<'PY'
import json, sys
version, body = sys.argv[1:3]
print(json.dumps({
    "tag_name": f"v{version}",
    "name": f"v{version}",
    "body": body,
    "draft": False,
    "prerelease": False,
}))
PY
)

HTTP=$(curl -s -o /tmp/release-gh.json -w '%{http_code}' \
  -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/releases" \
  -d "$JSON")

if [ "$HTTP" = "201" ]; then
  python3 -c "
import json
d = json.load(open('/tmp/release-gh.json'))
print('  GitHub Release published:', d['html_url'])
"
else
  echo "WARNING: GitHub Release publish returned HTTP $HTTP"
  head -c 400 /tmp/release-gh.json; echo
  echo "  The tag exists; publish the Release from the GitHub UI to enable"
  echo "  the extension's update notification."
fi

echo
echo "=========================================="
echo "  Released v$NEW"
echo "=========================================="
