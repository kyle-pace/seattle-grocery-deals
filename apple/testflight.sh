#!/bin/sh
# Archive the SwiftUI app and upload it to App Store Connect for TestFlight.
# Usage: apple/testflight.sh            archive and upload
#        apple/testflight.sh --dry-run  show the version, build number and paths, do nothing
#
# The build number is the number of commits on the current branch, so it always goes up
# and every build maps to a commit. The version comes from MARKETING_VERSION in project.yml.
# Signing uses the Apple ID signed in to Xcode (Settings > Accounts); Xcode creates any
# certificates and profiles it needs. Uses the first Xcode found (beta first); set
# XCODE=/path/to/Xcode.app to choose.
set -e
cd "$(dirname "$0")/GroceryDeals"

if [ -z "$XCODE" ]; then
  for x in "$HOME/Downloads/Xcode Beta.app" "$HOME/Downloads/Xcode.app" /Applications/Xcode-beta.app "/Applications/Xcode Beta.app" /Applications/Xcode.app; do
    [ -d "$x" ] && XCODE="$x" && break
  done
fi
[ -n "$XCODE" ] || { echo "No Xcode found. Set XCODE=/path/to/Xcode.app"; exit 1; }
export DEVELOPER_DIR="$XCODE/Contents/Developer"

command -v xcodegen >/dev/null || { echo "Install XcodeGen first: brew install xcodegen"; exit 1; }
xcodegen generate --quiet

# Only upload what's committed, so the build number points at real code.
if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes (or project.yml and the Xcode project are out of sync after xcodegen):"
  git status --short
  echo "Commit them first."
  exit 1
fi

VERSION=$(sed -n 's/^ *MARKETING_VERSION: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' project.yml | head -1)
BUILD=$(git rev-list --count HEAD)
COMMIT=$(git rev-parse --short HEAD)
ARCHIVE="$HOME/Library/Developer/Xcode/Archives/$(date +%Y-%m-%d)/GroceryDeals-$VERSION-$BUILD.xcarchive"
mkdir -p build

echo "Grocery Deals $VERSION ($BUILD) from $COMMIT, with $(basename "$XCODE")"
echo "Archive: $ARCHIVE"
[ "$1" = "--dry-run" ] && exit 0

echo "Archiving (a few minutes)..."
xcodebuild -project GroceryDeals.xcodeproj -scheme GroceryDeals -configuration Release \
  -destination "generic/platform=iOS" -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" archive > build/testflight-archive.log 2>&1 \
  || { grep -E "error:" build/testflight-archive.log | sort -u | head; echo "Archive failed; see apple/GroceryDeals/build/testflight-archive.log"; exit 1; }

echo "Uploading..."
rm -rf build/export
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist ../ExportOptions.plist \
  -exportPath build/export -allowProvisioningUpdates > build/testflight-upload.log 2>&1 \
  || { grep -E "error" build/testflight-upload.log | sort -u | head; echo "Upload failed; see apple/GroceryDeals/build/testflight-upload.log"; exit 1; }

echo "Uploaded $VERSION ($BUILD). Apple processes it in 5 to 15 minutes; check with:"
echo "  swift ~/Developer/asc-tools/asc.swift builds"
