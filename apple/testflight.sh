#!/bin/sh
# Send Grocery Deals to TestFlight. Tags the current commit and pushes the tag; Xcode Cloud
# builds it, archives it and uploads it to App Store Connect. Xcode Cloud sets the build number.
#
#   v<version>     the "TestFlight" workflow: internal testers only (you and the team)
#   beta-<version> the "TestFlight External" workflow: the External Testers group, after
#                  Apple's beta review. Notes for testers come from TestFlight/WhatToTest.en-US.txt
#
# Usage: apple/testflight.sh                       internal build: tag and push
#        apple/testflight.sh --external            external build: tag and push
#        apple/testflight.sh [--external] --dry-run  show the version and tag, do nothing
#
# The version comes from MARKETING_VERSION in project.yml. A second build of the same version
# gets <tag>-2, then -3 and so on (each kind counts on its own).
set -e
PREFIX=v
DRY=no
for arg in "$@"; do
  case "$arg" in
    --external) PREFIX=beta- ;;
    --dry-run) DRY=yes ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done
cd "$(dirname "$0")/GroceryDeals"

# Xcode Cloud builds the committed .xcodeproj, so make sure it matches project.yml.
if command -v xcodegen >/dev/null; then
  xcodegen generate --quiet
else
  echo "XcodeGen not found (brew install xcodegen); skipping the project check."
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes (or project.yml and the Xcode project are out of sync after xcodegen):"
  git status --short
  echo "Commit and push them first."
  exit 1
fi

# Xcode Cloud builds what's on GitHub, so the commit has to be pushed.
git fetch -q --tags origin
if [ -z "$(git branch -r --contains HEAD)" ]; then
  echo "This commit isn't on GitHub yet. Push it first."
  exit 1
fi

VERSION=$(sed -n 's/^ *MARKETING_VERSION: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' project.yml | head -1)
TAG="$PREFIX$VERSION"
N=2
while git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; do
  TAG="$PREFIX$VERSION-$N"
  N=$((N + 1))
done

if [ "$PREFIX" = beta- ]; then
  [ -s TestFlight/WhatToTest.en-US.txt ] || { echo "Write the notes for testers in apple/GroceryDeals/TestFlight/WhatToTest.en-US.txt first."; exit 1; }
  echo "External testers will see this under What to Test:"
  sed 's/^/  /' TestFlight/WhatToTest.en-US.txt
fi
echo "Grocery Deals $VERSION from $(git rev-parse --short HEAD): tag $TAG"
[ "$DRY" = yes ] && exit 0

git tag -a "$TAG" -m "TestFlight $VERSION"
git push -q origin "$TAG"
echo "Pushed $TAG. Xcode Cloud builds and uploads it (watch in Xcode's Report navigator or"
echo "App Store Connect, Xcode Cloud); TestFlight has it a few minutes after the upload."
