#!/bin/bash
# ==========================================
# TikTok Automation Bridge — Auto Update
# ==========================================
# Just double-click or run: ./update.sh
#
# Uses `git pull` — the repo is PRIVATE, so downloading the archive zip
# (github.com/.../archive/refs/heads/main.zip) returns 404. git handles auth.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  TikTok Automation Bridge — Update"
echo "=========================================="
echo ""

if [ ! -d .git ]; then
  echo "ERROR: This folder is not a git clone."
  echo "Re-clone the repo instead:"
  echo "  git clone https://github.com/yongprener/tiktok-automation-bridge.git"
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

BEFORE=$(git rev-parse --short HEAD)

echo "Pulling latest code..."
if ! git pull origin main; then
  echo ""
  echo "ERROR: git pull failed."
  echo "Common causes:"
  echo "  - no access to the private repo (check your GitHub token)"
  echo "  - local changes not committed"
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

AFTER=$(git rev-parse --short HEAD)

VERSION=$(python3 -c "import json; print(json.load(open('chrome-extension/manifest.json'))['version'])" 2>/dev/null || echo "unknown")

echo ""
echo "=========================================="
if [ "$BEFORE" = "$AFTER" ]; then
  echo "  Already up to date (v$VERSION)"
else
  echo "  Updated: $BEFORE -> $AFTER (v$VERSION)"
fi
echo "=========================================="
echo ""
echo "Now go to chrome://extensions and click the"
echo "reload button (refresh icon) on the extension card."
echo ""
read -p "Press Enter to close..."
