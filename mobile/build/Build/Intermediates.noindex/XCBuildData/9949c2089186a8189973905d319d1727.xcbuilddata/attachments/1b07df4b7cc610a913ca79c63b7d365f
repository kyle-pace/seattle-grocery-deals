#!/bin/sh
# Cleanup generated codegen files for prebuilt libraries to avoid duplicate symbols
# When a library is prebuilt as an XCFramework, its codegen output is already included in the framework.
# We need to remove the generated files so they don't get compiled into the ReactCodegen pod as well.
# NOTE: The source file references have already been removed from the Xcode project during pod install,
# but we still need to delete the files because codegen regenerates them on each build.

PREBUILT_CODEGEN_LIBS=()
CODEGEN_OUTPUT_DIR="$PODS_ROOT/../build/generated/ios/ReactCodegen"

if [ ${#PREBUILT_CODEGEN_LIBS[@]} -gt 0 ]; then
  echo "[Expo] Cleaning up codegen output for prebuilt libraries: ${PREBUILT_CODEGEN_LIBS[*]}"

  for lib in "${PREBUILT_CODEGEN_LIBS[@]}"; do
    # Remove module directory (contains .h and -generated.mm files)
    if [ -d "$CODEGEN_OUTPUT_DIR/$lib" ]; then
      echo "[Expo] Removing module: $CODEGEN_OUTPUT_DIR/$lib"
      rm -rf "$CODEGEN_OUTPUT_DIR/$lib"
    fi

    # Remove JSI header file
    if [ -f "$CODEGEN_OUTPUT_DIR/${lib}JSI.h" ]; then
      echo "[Expo] Removing JSI header: $CODEGEN_OUTPUT_DIR/${lib}JSI.h"
      rm -f "$CODEGEN_OUTPUT_DIR/${lib}JSI.h"
    fi

    # Remove components directory
    if [ -d "$CODEGEN_OUTPUT_DIR/react/renderer/components/$lib" ]; then
      echo "[Expo] Removing components: $CODEGEN_OUTPUT_DIR/react/renderer/components/$lib"
      rm -rf "$CODEGEN_OUTPUT_DIR/react/renderer/components/$lib"
    fi
  done
fi

# Touch the stamp file for Xcode dependency tracking
mkdir -p "$DERIVED_FILE_DIR"
touch "$DERIVED_FILE_DIR/expo-codegen-cleanup.stamp"

