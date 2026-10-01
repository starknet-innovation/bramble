#!/usr/bin/env bash
# Builds the Rust core for iOS and generates its Swift bindings.
#
#   mobile/ios/Generated/BrambleCoreFFI.xcframework   device (arm64) + simulator (arm64)
#   mobile/ios/Generated/Swift/BrambleCore.swift      UniFFI bindings compiled into the app
#
# Usage: mobile/scripts/build-core-ios.sh [release|debug]   (default: release)
set -euo pipefail

PROFILE="${1:-release}"
MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="$MOBILE_DIR/core"
OUT_DIR="$MOBILE_DIR/ios/Generated"
TARGETS=(aarch64-apple-ios aarch64-apple-ios-sim)
CARGO_FLAGS=(--locked --lib)
[[ "$PROFILE" == "release" ]] && CARGO_FLAGS+=(--release)

for target in "${TARGETS[@]}"; do
  rustup target list --installed | grep -qx "$target" || rustup target add "$target"
  (cd "$CORE_DIR" && IPHONEOS_DEPLOYMENT_TARGET=17.0 cargo build "${CARGO_FLAGS[@]}" --target "$target")
done

# Bindings come from the host build's metadata, so they match the exact source compiled above.
(cd "$CORE_DIR" && cargo build --locked --lib)
rm -rf "$OUT_DIR" && mkdir -p "$OUT_DIR/Swift" "$OUT_DIR/headers"
(cd "$CORE_DIR" && cargo run --locked --quiet --features bindgen --bin uniffi-bindgen -- \
  generate --library target/debug/libbramble_core.dylib --language swift --out-dir "$OUT_DIR/bindings")

mv "$OUT_DIR/bindings/BrambleCore.swift" "$OUT_DIR/Swift/"
mv "$OUT_DIR/bindings/bramble_coreFFI.h" "$OUT_DIR/headers/"
# The XCFramework's module must be named after the header the Swift bindings import.
cat > "$OUT_DIR/headers/module.modulemap" <<'MAP'
module bramble_coreFFI {
    header "bramble_coreFFI.h"
    export *
}
MAP
rm -rf "$OUT_DIR/bindings"

xcodebuild -create-xcframework \
  -library "$CORE_DIR/target/aarch64-apple-ios/$PROFILE/libbramble_core.a" -headers "$OUT_DIR/headers" \
  -library "$CORE_DIR/target/aarch64-apple-ios-sim/$PROFILE/libbramble_core.a" -headers "$OUT_DIR/headers" \
  -output "$OUT_DIR/BrambleCoreFFI.xcframework" >/dev/null

echo "iOS core ($PROFILE) -> $OUT_DIR"
