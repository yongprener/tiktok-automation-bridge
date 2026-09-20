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

# chrome-extension/lib/skills-bundled.js is generated. If it drifts from
# skills/bundled.json the extension ships stale skills, silently.
import subprocess as _sp
_r = _sp.run(['python3', 'scripts/sync-skills.py', '--check'], capture_output=True, text=True)
print('  ' + ('ok  ' if _r.returncode == 0 else '!!  ') + _r.stdout.strip().lstrip())
assert _r.returncode == 0, 'skills-bundled.js out of sync — run python3 scripts/sync-skills.py' 

# Fire the "forgot to bump the version" tripwire. Only meaningful when the
# EXTENSION SOURCE differs from the tagged release — a docs/test-only commit
# must not trip it, otherwise the warning becomes noise nobody reads.
import subprocess, os
ver = m['version']
if os.path.isdir('.git'):
    has_tag = subprocess.run(['git','rev-parse','--verify','-q',f'v{ver}'],
                             capture_output=True, text=True).returncode == 0
    if not has_tag:
        print(f"  ok  v{ver} not tagged yet (expected pre-release)")
    else:
        diff = subprocess.run(['git','diff','--quiet',f'v{ver}','--','chrome-extension/'],
                              capture_output=True)
        if diff.returncode == 0:
            print(f"  ok  extension source matches tag v{ver}")
        else:
            print(f"  !!  chrome-extension/ has changes not in tag v{ver}")
            print(f"  !!  run ./scripts/release.sh patch to cut a release")
else:
    print(f"  ok  not a git checkout, tag check skipped")
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
echo "── skill system + intent router ──────────"
node tests/skill.test.js

echo
echo "✅ ALL SUITES PASSED"
