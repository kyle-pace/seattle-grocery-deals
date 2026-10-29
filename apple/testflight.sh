#!/bin/sh
# Send Grocery Deals to TestFlight. Tags the current commit as v<version> and pushes the tag;
# Xcode Cloud's "TestFlight" workflow builds every tag that starts with "v", archives it and
# uploads it to App Store Connect. Xcode Cloud sets the build number.
# Usage: apple/testflight.sh            tag and push
#        apple/testflight.sh --dry-run  show the version and tag, do nothing
#
# The version comes from MARKETING_VERSION in project.yml. A second TestFlight build of the
# same version gets v<version>-2, then -3 and so on.
set -e
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
TAG="v$VERSION"
N=2
while git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; do
  TAG="v$VERSION-$N"
  N=$((N + 1))
done

echo "Grocery Deals $VERSION from $(git rev-parse --short HEAD): tag $TAG"
[ "$1" = "--dry-run" ] && exit 0

git tag -a "$TAG" -m "TestFlight $VERSION"
git push -q origin "$TAG"
echo "Pushed $TAG. Xcode Cloud builds and uploads it (watch in Xcode's Report navigator or"
echo "App Store Connect, Xcode Cloud); TestFlight has it a few minutes after the upload."
