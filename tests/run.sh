#!/usr/bin/env bash
# Run all tests. Usage: ./tests/run.sh
set -e
cd "$(dirname "$0")/.."

echo "── syntax check ──────────────────────────"
for f in chrome-extension/*.js chrome-extension/lib/*.js; do
  node --check "$f" && echo "  ok  $f"
done

echo
echo "── manifest sanity ───────────────────────"
python3 - <<'PY'
import json
m = json.load(open('chrome-extension/manifest.json'))
assert m['manifest_version'] == 3, 'must be MV3'
assert 'background' in m and 'service_worker' in m['background']
for p in ('storage','alarms','scripting','identity','identity.email'):
    assert p in m['permissions'], f'missing permission: {p}'
print(f"  ok  v{m['version']}, {len(m['permissions'])} permissions")

# Versioning: manifest.json is the SINGLE source of truth. background.js and
# popup.js must read it via chrome.runtime.getManifest().version, never
# hardcode a literal — a hardcoded copy drifts and shows a false "stale
# service worker" banner.
import re
for f in ('chrome-extension/background.js', 'chrome-extension/popup.js'):
    src = open(f).read()
    assert 'chrome.runtime.getManifest().version' in src, \
        f'{f} must derive its version from the manifest'
    hard = re.findall(r"(?:CURRENT_VERSION|EXPECTED_VERSION)\s*=\s*'", src)
    assert not hard, f'{f} still hardcodes a version literal'
print(f"  ok  version derived from manifest in both files")
print(f"  ok  git tag should match: v{m['version']}")
PY

echo
echo "── background smoke ──────────────────────"
node tests/smoke.js

echo
echo "── popup behavior ────────────────────────"
node tests/popup.test.js

echo
echo "── options behavior ──────────────────────"
node tests/options.test.js

echo
echo "✅ ALL SUITES PASSED"
