#!/bin/sh
# Xcode Cloud runs this right after it clones the repo, before it resolves Swift packages.
# On the Mac, KitchenUI is a local package checked out next to this repo (~/Developer/KitchenUI,
# which project.yml reaches as ../../../KitchenUI). Put a copy of its main branch in the same place.
set -e
PARENT="$CI_PRIMARY_REPOSITORY_PATH/.."
# The kitchen repos are private. KITCHEN_GITHUB_TOKEN is a secret environment variable on the
# Xcode Cloud workflow: a fine-grained GitHub token with read-only Contents access to kitchen-ui
# and kitchen-catalog. It's sent as a header, so it never lands in a git remote or the log.
if [ -n "$KITCHEN_GITHUB_TOKEN" ]; then
  KITCHEN_AUTH="Authorization: Basic $(printf 'x-access-token:%s' "$KITCHEN_GITHUB_TOKEN" | base64 | tr -d '\n')"
else
  echo "warning: KITCHEN_GITHUB_TOKEN isn't set on this workflow; the clone only works if the kitchen repos are public."
  KITCHEN_AUTH="X-No-Auth: 1"
fi
echo "Cloning KitchenUI next to the repo..."
git -c http.extraHeader="$KITCHEN_AUTH" clone --depth 1 https://github.com/kyle-pace/kitchen-ui.git "$PARENT/KitchenUI"
echo "KitchenUI at $(git -C "$PARENT/KitchenUI" rev-parse --short HEAD)"

# The week bundled with the app only shows when the very first launch can't reach the site.
# Ship the current one, not whatever was last committed. If the site can't be reached or the
# answer doesn't look like a week, the committed copy stays.
WEEK="$CI_PRIMARY_REPOSITORY_PATH/apple/GroceryDeals/Resources/week.json"
if curl -fsS --max-time 30 https://seattlegrocery.deals/api/week.json -o "$WEEK.new" && grep -q '"items"' "$WEEK.new"; then
  mv "$WEEK.new" "$WEEK"
  echo "Bundled week refreshed from the site."
else
  rm -f "$WEEK.new"
  echo "warning: couldn't refresh the bundled week; shipping the committed copy."
fi

# Internal TestFlight builds carry the developer menu (KitchenUI's BuildKind). The internal
# workflow starts on tags beginning with v and archives as internal-only, which Apple never
# lets reach external testers or the App Store; mark those builds here. Public builds
# (beta- tags, or any other workflow) are never marked. A manual start of the internal workflow
# from a branch has no tag, so the workflow's name ("TestFlight") counts too.
INTERNAL_BUILD=no
case "$CI_TAG" in v*) INTERNAL_BUILD=yes ;; esac
[ "$CI_WORKFLOW" = "TestFlight" ] && INTERNAL_BUILD=yes
case "$INTERNAL_BUILD" in
  yes)
    for PLIST in apple/GroceryDeals/Sources/Info.plist; do
      /usr/libexec/PlistBuddy -c "Add :KitchenInternalBuild bool true" "$CI_PRIMARY_REPOSITORY_PATH/$PLIST" \
        && echo "Marked $PLIST as an internal build." \
        || echo "warning: couldn't mark $PLIST; this build won't show the developer menu."
    done
    # The DEV icon and the name "Deals Int" too, so an internal build on the Home Screen can't
    # be mistaken for the public one (they share a bundle ID, so only one is installed at a
    # time; Settings also says which build it is). Same switches install-on-iphone.sh uses
    # (it names its builds "Deals Dev"); the bundle ID stays as it is.
    PROJ="$CI_PRIMARY_REPOSITORY_PATH/apple/GroceryDeals/GroceryDeals.xcodeproj/project.pbxproj"
    if sed -i '' 's/APP_ICON_SUFFIX = "";/APP_ICON_SUFFIX = Dev;/' "$PROJ" && grep -q 'APP_ICON_SUFFIX = Dev;' "$PROJ"; then
      echo "Internal build: using the DEV app icon."
    else
      echo "warning: couldn't switch to the DEV app icon; this build has the regular one."
    fi
    if sed -i '' 's/APP_NAME_SUFFIX = "";/APP_NAME_SUFFIX = " Int";/' "$PROJ" && grep -q 'APP_NAME_SUFFIX = " Int";' "$PROJ"; then
      echo "Internal build: named Deals Int."
    else
      echo "warning: couldn't rename this build; it shows as Deals."
    fi
    ;;
esac
