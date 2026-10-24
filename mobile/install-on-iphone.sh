#!/bin/sh
# Build a standalone release of the app and install it on a plugged-in, unlocked iPhone.
# Usage: ./install-on-iphone.sh            (uses the first connected iPhone)
# Uses the first Xcode found (beta first); set XCODE=/path/to/Xcode.app to choose. It must support the
# phone's iOS version, so an iOS beta needs the Xcode beta.
set -e
cd "$(dirname "$0")"
if [ -z "$XCODE" ]; then
  for x in "$HOME/Downloads/Xcode Beta.app" "$HOME/Downloads/Xcode.app" /Applications/Xcode-beta.app "/Applications/Xcode Beta.app" /Applications/Xcode.app /Applications/Utilities/Xcode.app; do
    [ -d "$x" ] && XCODE="$x" && break
  done
fi
export DEVELOPER_DIR="$XCODE/Contents/Developer"
export LANG=en_US.UTF-8 CI=1
TEAM=$(node -p 'require("./app.json").expo.ios.appleTeamId')
DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && (/available/ || /connected/) && !/simulated/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) { print $i; exit } }')
[ -n "$DEVICE" ] || { echo "No iPhone found. Plug it in, unlock it, and trust this Mac."; exit 1; }
npx expo prebuild --platform ios
(cd ios && xcodebuild -workspace GroceryDeals.xcworkspace -scheme GroceryDeals -configuration Release \
  -destination "generic/platform=iOS" -derivedDataPath ../build -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic build > ../build.log 2>&1) \
  || { grep -E "error:" build.log | sort -u | head; echo "Build failed; see mobile/build.log"; exit 1; }
xcrun devicectl device install app --device "$DEVICE" build/Build/Products/Release-iphoneos/GroceryDeals.app
xcrun devicectl device process launch --device "$DEVICE" deals.seattlegrocery.app
