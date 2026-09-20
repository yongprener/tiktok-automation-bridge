#!/usr/bin/env bash
# Run all tests. Usage: ./tests/run.sh
set -e
cd "$(dirname "$0")/.."
echo "── syntax check ──────────────────────────"
for f in chrome-extension/*.js chrome-extension/lib/*.js; do
  node --check "$f" && echo "  ok  $f"
done
echo
echo "── background smoke ──────────────────────"
node tests/smoke.js
echo
echo "── popup behavior ────────────────────────"
node tests/popup.test.js
echo
echo "✅ ALL SUITES PASSED"
