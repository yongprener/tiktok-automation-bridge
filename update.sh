#!/bin/bash
# ==========================================
# TikTok Automation Bridge — Auto Update
# ==========================================
# Just double-click or run: ./update.sh
# Downloads latest version from GitHub and replaces files.

set -e

REPO="yongprener/tiktok-automation-bridge"
BRANCH="main"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="/tmp/tiktab-update"
ZIP_FILE="$TMP_DIR/tiktab-latest.zip"
EXTRACT_DIR="$TMP_DIR/extracted"

echo "=========================================="
echo "  TikTok Automation Bridge — Update"
echo "=========================================="
echo ""

# Download latest
echo "Downloading latest version..."
mkdir -p "$TMP_DIR"
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"

curl -sL "https://github.com/$REPO/archive/refs/heads/$BRANCH.zip" -o "$ZIP_FILE"

# Extract
echo "Extracting..."
unzip -qo "$ZIP_FILE" -d "$EXTRACT_DIR"

# Find the extracted folder (github adds -branch suffix)
EXTRACTED_FOLDER=$(find "$EXTRACT_DIR" -maxdepth 1 -type d | tail -1)

if [ ! -d "$EXTRACTED_FOLDER/chrome-extension" ]; then
  echo "ERROR: Could not find chrome-extension folder in download."
  echo "Check your internet connection."
  exit 1
fi

# Replace files
echo "Updating files..."
cp -Rf "$EXTRACTED_FOLDER/chrome-extension/"* "$SCRIPT_DIR/chrome-extension/"

# Clean up
rm -rf "$TMP_DIR"

# Get latest version from manifest
VERSION=$(python3 -c "import json; print(json.load(open('$SCRIPT_DIR/chrome-extension/manifest.json'))['version'])" 2>/dev/null || echo "unknown")

echo ""
echo "=========================================="
echo "  Updated to v$VERSION"
echo "=========================================="
echo ""
echo "Now go to chrome://extensions and click the"
echo "refresh button on the extension card."
echo ""
read -p "Press Enter to close..."
