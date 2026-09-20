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

# version must agree across files, otherwise the popup shows a stale-SW banner forever
import re
bg = re.search(r"CURRENT_VERSION\s*=\s*'([^']+)'", open('chrome-extension/background.js').read()).group(1)
pu = re.search(r"EXPECTED_VERSION\s*=\s*'([^']+)'", open('chrome-extension/popup.js').read()).group(1)
assert m['version'] == bg == pu, f'version mismatch: manifest={m["version"]} bg={bg} popup={pu}'
print(f"  ok  version consistent: {m['version']}")
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
