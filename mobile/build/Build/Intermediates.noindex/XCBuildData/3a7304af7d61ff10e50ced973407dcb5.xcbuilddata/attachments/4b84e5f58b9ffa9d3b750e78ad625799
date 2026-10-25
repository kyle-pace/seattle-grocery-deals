#!/bin/sh
if [[ -f "$SRCROOT/.xcode.env" ]]; then
  source "$SRCROOT/.xcode.env"
fi
if [[ -f "$SRCROOT/.xcode.env.local" ]]; then
  source "$SRCROOT/.xcode.env.local"
fi

# The project root by default is one level up from the ios directory
export PROJECT_ROOT="$PROJECT_DIR"/..

if [[ "$CONFIGURATION" = *Debug* ]]; then
  export SKIP_BUNDLING=1
fi
if [[ -z "$ENTRY_FILE" ]]; then
  # Set the entry JS file using the bundler's entry resolution.
  export ENTRY_FILE="$("$NODE_BINARY" -e "require('expo/scripts/resolveAppEntry')" "$PROJECT_ROOT" ios absolute | tail -n 1)"
fi

if [[ -z "$CLI_PATH" ]]; then
  # Use Expo CLI
  export CLI_PATH="$("$NODE_BINARY" --print "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })")"
fi
if [[ -z "$BUNDLE_COMMAND" ]]; then
  # Default Expo CLI command for bundling
  export BUNDLE_COMMAND="export:embed"
fi

# Source .xcode.env.updates if it exists to allow
# SKIP_BUNDLING to be unset if needed
if [[ -f "$SRCROOT/.xcode.env.updates" ]]; then
  source "$SRCROOT/.xcode.env.updates"
fi
# Source local changes to allow overrides
# if needed
if [[ -f "$SRCROOT/.xcode.env.local" ]]; then
  source "$SRCROOT/.xcode.env.local"
fi

"`"$NODE_BINARY" --print "require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'"`"


