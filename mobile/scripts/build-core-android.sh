#!/usr/bin/env bash
# Builds the Rust core for Android and generates its Kotlin bindings.
#
#   mobile/android/app/src/main/jniLibs/<abi>/libbramble_core.so
#   mobile/android/app/build/generated/uniffi/org/bramble/core/bramble_core.kt (UniFFI names it after the crate)
#
# Requires the Android NDK (ANDROID_NDK_HOME) and `cargo install cargo-ndk --version 4.1.2 --locked`.
# Usage: mobile/scripts/build-core-android.sh [release|debug]   (default: release)
set -euo pipefail

PROFILE="${1:-release}"
MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="$MOBILE_DIR/core"
APP_DIR="$MOBILE_DIR/android/app"
ABIS=(arm64-v8a x86_64)
CARGO_FLAGS=(--locked --lib)
[[ "$PROFILE" == "release" ]] && CARGO_FLAGS+=(--release)

: "${ANDROID_NDK_HOME:?set ANDROID_NDK_HOME to an installed NDK}"
command -v cargo-ndk >/dev/null || { echo "cargo-ndk is required" >&2; exit 1; }
rustup target add aarch64-linux-android x86_64-linux-android >/dev/null

ndk_args=()
for abi in "${ABIS[@]}"; do ndk_args+=(-t "$abi"); done
(cd "$CORE_DIR" && cargo ndk "${ndk_args[@]}" --platform 28 -o "$APP_DIR/src/main/jniLibs" build "${CARGO_FLAGS[@]}")

(cd "$CORE_DIR" && cargo build --locked --lib)
rm -rf "$APP_DIR/build/generated/uniffi"
(cd "$CORE_DIR" && cargo run --locked --quiet --features bindgen --bin uniffi-bindgen -- \
  generate --library target/debug/libbramble_core.dylib --language kotlin \
  --out-dir "$APP_DIR/build/generated/uniffi")

echo "Android core ($PROFILE) -> $APP_DIR"
