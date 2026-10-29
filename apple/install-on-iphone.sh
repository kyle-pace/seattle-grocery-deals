#!/bin/sh
# Build "Deals Dev" (dev bundle ID, name and DEV icon, next to the TestFlight or App Store app)
# and install it on every linked iPhone and iPad, plugged in or paired over Wi-Fi, unlocked and trusted.
# Usage: apple/install-on-iphone.sh            build what's checked out, install, open it
#        apple/install-on-iphone.sh --no-open  install without opening
# Or from anywhere: `phone deals` (KitchenUI's tools/phone).
# Uses the first Xcode found (beta first); set XCODE=/path/to/Xcode.app to choose. An iOS beta
# on the phone needs the Xcode beta.
set -e
cd "$(dirname "$0")/GroceryDeals"
OPEN=yes
[ "$1" = "--no-open" ] && OPEN=no

if [ -z "$XCODE" ]; then
  for x in "$HOME/Downloads/Xcode Beta.app" "$HOME/Downloads/Xcode.app" /Applications/Xcode-beta.app "/Applications/Xcode Beta.app" /Applications/Xcode.app /Applications/Utilities/Xcode.app; do
    [ -d "$x" ] && XCODE="$x" && break
  done
fi
[ -n "$XCODE" ] || { echo "No Xcode found. Set XCODE=/path/to/Xcode.app"; exit 1; }
export DEVELOPER_DIR="$XCODE/Contents/Developer"

# Every linked iPhone or iPad (plugged in, or paired over Wi-Fi in Xcode's Devices window).
DEVICES=$(xcrun devicectl list devices 2>/dev/null | awk '!/simulated/ && (/available/ || /connected/) { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/ || $i ~ /^[0-9A-F-]{36}$/) { print $i; break } }')
[ -n "$DEVICES" ] || { echo "No iPhone or iPad found. Plug it in (or pair it over Wi-Fi in Xcode's Devices window), unlock it, and trust this Mac."; exit 1; }
command -v xcodegen >/dev/null || { echo "Install XcodeGen first: brew install xcodegen"; exit 1; }

echo "Deals Dev from $(git rev-parse --abbrev-ref HEAD) at $(git rev-parse --short HEAD)$( [ -n "$(git status --porcelain)" ] && echo ', with uncommitted changes'), $(basename "$XCODE")"
xcodegen generate --quiet
echo "Building..."
xcodebuild -project GroceryDeals.xcodeproj -scheme GroceryDeals -configuration Release -destination "generic/platform=iOS" \
  -derivedDataPath build -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  BUNDLE_ID_SUFFIX=.dev APP_NAME_SUFFIX=" Dev" APP_ICON_SUFFIX=Dev build > build.log 2>&1 \
  || { grep -E "error:" build.log | sort -u | head; echo "Build failed; see apple/GroceryDeals/build.log"; exit 1; }
APP=build/Build/Products/Release-iphoneos/GroceryDeals.app
for DEVICE in $DEVICES; do
  NAME=$(xcrun devicectl list devices 2>/dev/null | grep "$DEVICE" | awk '{print $1}')
  echo "Installing on $NAME..."
  # One retry: a device that just locked or dropped Wi-Fi often says "Connection invalid" once.
  if xcrun devicectl device install app --device "$DEVICE" "$APP" > /dev/null 2>&1 \
     || { sleep 3; xcrun devicectl device install app --device "$DEVICE" "$APP" > /dev/null 2>&1; }; then
    echo "Deals Dev is on $NAME."
    if [ "$OPEN" = yes ]; then
      xcrun devicectl device process launch --device "$DEVICE" deals.seattlegrocery.dev > /dev/null 2>&1 || echo "(Unlock $NAME to open it.)"
    fi
  else
    echo "Couldn't install on $NAME. Unlock it; if it's new, build once from Xcode with it selected so it's added to the profile, then run this again."
  fi
done
