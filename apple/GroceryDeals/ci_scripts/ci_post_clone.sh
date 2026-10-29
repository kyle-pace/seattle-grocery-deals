#!/bin/sh
# Xcode Cloud runs this right after it clones the repo, before it resolves Swift packages.
# On the Mac, KitchenUI is a local package checked out next to this repo (~/Developer/KitchenUI,
# which project.yml reaches as ../../../KitchenUI). Put a copy of its main branch in the same place.
set -e
PARENT="$CI_PRIMARY_REPOSITORY_PATH/.."
echo "Cloning KitchenUI next to the repo..."
git clone --depth 1 https://github.com/kyle-pace/kitchen-ui.git "$PARENT/KitchenUI"
echo "KitchenUI at $(git -C "$PARENT/KitchenUI" rev-parse --short HEAD)"
