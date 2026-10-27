#!/bin/sh
# Build the SwiftUI app and install it on a plugged-in, unlocked, trusted iPhone.
# Usage: apple/install-on-iphone.sh. Uses the first Xcode found (beta first); set
# XCODE=/path/to/Xcode.app to choose. An iOS beta on the phone needs the Xcode beta.
set -e
cd "$(dirname "$0")/GroceryDeals"
if [ -z "$XCODE" ]; then
  for x in "$HOME/Downloads/Xcode Beta.app" "$HOME/Downloads/Xcode.app" /Applications/Xcode-beta.app "/Applications/Xcode Beta.app" /Applications/Xcode.app /Applications/Utilities/Xcode.app; do
    [ -d "$x" ] && XCODE="$x" && break
  done
fi
export DEVELOPER_DIR="$XCODE/Contents/Developer"
DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && (/available/ || /connected/) && !/simulated/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) { print $i; exit } }')
[ -n "$DEVICE" ] || { echo "No iPhone found. Plug it in, unlock it, and trust this Mac."; exit 1; }
command -v xcodegen >/dev/null || { echo "Install XcodeGen first: brew install xcodegen"; exit 1; }
xcodegen generate --quiet
xcodebuild -project GroceryDeals.xcodeproj -scheme GroceryDeals -configuration Release -destination "generic/platform=iOS" \
  -derivedDataPath build -allowProvisioningUpdates -allowProvisioningDeviceRegistration build > build.log 2>&1 \
  || { grep -E "error:" build.log | sort -u | head; echo "Build failed; see apple/GroceryDeals/build.log"; exit 1; }
xcrun devicectl device install app --device "$DEVICE" build/Build/Products/Release-iphoneos/GroceryDeals.app
xcrun devicectl device process launch --device "$DEVICE" deals.seattlegrocery
