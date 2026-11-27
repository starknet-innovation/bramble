#!/usr/bin/env bash
# Downloads the pinned mobile lint tools into mobile/.tools (git-ignored) and verifies each one
# against the SHA-256 recorded below. Nothing is installed system-wide, and nothing is resolved by
# name at run time: a download whose digest differs is deleted and the script fails.
#
#   SwiftLint 0.65.1   portable_swiftlint.zip (macOS universal binary)
#   ktlint    1.8.0    self-executing jar
#   detekt    1.23.8   detekt-cli all-in-one jar
#   XcodeGen  2.44.1   xcodegen.zip (macOS; generates the Xcode project in CI)
#
# Digests were computed from the official GitHub release assets. For SwiftLint, ktlint and
# XcodeGen they equal the digest GitHub publishes for the asset. detekt 1.23.8 predates GitHub
# asset digests, so its value is the one computed here from the release asset (the Maven Central
# `-all` jar is a different build and does not match). To bump a tool, change its version, URL and
# digest together, and say where the new digest came from in the commit.
#
# Usage: mobile/scripts/lint-tools.sh [swift|kotlin|xcodegen|all]   (default: all)
# Sourced by lint.sh for the tool paths and the Java lookup.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$MOBILE_DIR/.tools"

SWIFTLINT_VERSION="0.65.1"
SWIFTLINT_URL="https://github.com/realm/SwiftLint/releases/download/$SWIFTLINT_VERSION/portable_swiftlint.zip"
SWIFTLINT_SHA256="c1e429b0599cf1b516f369a2d9ec04eaf0e436f3c12b637df8851fa52ff694d0"
SWIFTLINT_BIN="$TOOLS_DIR/swiftlint-$SWIFTLINT_VERSION/swiftlint"

KTLINT_VERSION="1.8.0"
KTLINT_URL="https://github.com/ktlint/ktlint/releases/download/$KTLINT_VERSION/ktlint"
KTLINT_SHA256="a3fd620207d5c40da6ca789b95e7f823c54e854b7fade7f613e91096a3706d75"
KTLINT_JAR="$TOOLS_DIR/ktlint-$KTLINT_VERSION.jar"

DETEKT_VERSION="1.23.8"
DETEKT_URL="https://github.com/detekt/detekt/releases/download/v$DETEKT_VERSION/detekt-cli-$DETEKT_VERSION-all.jar"
DETEKT_SHA256="2ce2ff952e150baf28a29cda70a363b0340b3e81a55f43e51ec5edffc3d066c1"
DETEKT_JAR="$TOOLS_DIR/detekt-cli-$DETEKT_VERSION-all.jar"

XCODEGEN_VERSION="2.44.1"
XCODEGEN_URL="https://github.com/yonaskolb/XcodeGen/releases/download/$XCODEGEN_VERSION/xcodegen.zip"
XCODEGEN_SHA256="a2e905fb68446e9bb4008cdfe2e13e3f176d0cbcca828b71770f8e53fca91b73"
XCODEGEN_BIN="$TOOLS_DIR/xcodegen-$XCODEGEN_VERSION/xcodegen/bin/xcodegen"

# Homebrew's keg-only OpenJDK: present on the development Macs, never linked onto PATH.
HOMEBREW_JDK="/opt/homebrew/opt/openjdk"

sha256_of() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# fetch <url> <sha256> <destination>: downloads to a temporary name, verifies, then moves into
# place. An existing destination is re-verified, so a tampered cache fails as loudly as a download.
fetch() {
  local url="$1" expected="$2" dest="$3" actual
  if [[ -f "$dest" ]]; then
    actual="$(sha256_of "$dest")"
    [[ "$actual" == "$expected" ]] && return 0
    echo "lint-tools: cached $(basename "$dest") has SHA-256 $actual, expected $expected; refetching" >&2
    rm -f "$dest"
  fi
  mkdir -p "$(dirname "$dest")"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 -o "$dest.partial" "$url"
  actual="$(sha256_of "$dest.partial")"
  if [[ "$actual" != "$expected" ]]; then
    rm -f "$dest.partial"
    echo "lint-tools: SHA-256 mismatch for $url" >&2
    echo "  expected $expected" >&2
    echo "  actual   $actual" >&2
    exit 1
  fi
  mv "$dest.partial" "$dest"
}

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "lint-tools: $1 is a macOS binary; run the $1 step on macOS" >&2
    exit 1
  fi
}

install_swiftlint() {
  require_macos SwiftLint
  local archive="$TOOLS_DIR/downloads/portable_swiftlint-$SWIFTLINT_VERSION.zip"
  fetch "$SWIFTLINT_URL" "$SWIFTLINT_SHA256" "$archive"
  rm -rf "$(dirname "$SWIFTLINT_BIN")"
  unzip -q "$archive" swiftlint -d "$(dirname "$SWIFTLINT_BIN")"
  chmod +x "$SWIFTLINT_BIN"
}

install_xcodegen() {
  require_macos XcodeGen
  local archive="$TOOLS_DIR/downloads/xcodegen-$XCODEGEN_VERSION.zip"
  fetch "$XCODEGEN_URL" "$XCODEGEN_SHA256" "$archive"
  rm -rf "$TOOLS_DIR/xcodegen-$XCODEGEN_VERSION"
  unzip -q "$archive" -d "$TOOLS_DIR/xcodegen-$XCODEGEN_VERSION"
  chmod +x "$XCODEGEN_BIN"
}

install_kotlin_tools() {
  fetch "$KTLINT_URL" "$KTLINT_SHA256" "$KTLINT_JAR"
  fetch "$DETEKT_URL" "$DETEKT_SHA256" "$DETEKT_JAR"
}

# Prints the java executable: $JAVA_HOME first, then Homebrew's keg-only OpenJDK. There is no
# PATH fallback, so the JDK in use is always one the caller chose.
resolve_java() {
  local home="${JAVA_HOME:-}"
  if [[ -z "$home" && -x "$HOMEBREW_JDK/bin/java" ]]; then
    home="$HOMEBREW_JDK"
  fi
  if [[ -z "$home" || ! -x "$home/bin/java" ]]; then
    echo "lint-tools: no JDK found. Set JAVA_HOME to a JDK 17+ (ktlint and detekt run on it)," >&2
    echo "  or install Homebrew's openjdk so $HOMEBREW_JDK exists." >&2
    exit 1
  fi
  echo "$home/bin/java"
}

main() {
  case "${1:-all}" in
    swift) install_swiftlint ;;
    kotlin) install_kotlin_tools ;;
    xcodegen) install_xcodegen ;;
    all)
      install_swiftlint
      install_kotlin_tools
      ;;
    *)
      echo "usage: $0 [swift|kotlin|xcodegen|all]" >&2
      exit 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
