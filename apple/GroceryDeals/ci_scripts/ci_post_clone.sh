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
