#!/usr/bin/env bash
# Runs the pinned mobile linters and exits non-zero on any finding. Tools come from
# mobile/scripts/lint-tools.sh (downloaded once into mobile/.tools and SHA-256 verified).
#
#   swift                   SwiftLint over mobile/ios (strict; macOS only)
#   kotlin                  ktlint (official style) and detekt (all rules) over mobile/android
#   all                     both of the above (default); `bun run mobile:lint`
#   swift-analyze <log>     SwiftLint's analyzer rules (unused_import, unused_declaration, ...)
#                           over an xcodebuild log of a clean build, e.g.
#                           xcodebuild ... clean build-for-testing | tee build/xcodebuild.log
#
# Configs: mobile/ios/.swiftlint.yml, mobile/android/.editorconfig, mobile/android/config/detekt.yml.
# Generated sources (*.generated.swift|kt, ios/Generated, Gradle build output) are excluded there.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lint-tools.sh"

IOS_DIR="$MOBILE_DIR/ios"
ANDROID_DIR="$MOBILE_DIR/android"
failed=()

# AGENTS.md forbids suppressing a lint rule in source; a suppression is a finding, not a fix.
# The marker is assembled so this script does not match its own text.
SUPPRESSION_PATTERN="swiftlint""[:](disable|enable)|@Suppress""(Warnings|Lint)?\\b|ktlint""-disable|detekt""[:]"

# scan_suppressions <label> <dir> <glob>...: reports every suppression marker under dir.
scan_suppressions() {
  local label="$1" dir="$2"
  shift 2
  local includes=()
  for glob in "$@"; do includes+=(--include="$glob"); done
  echo "== suppression markers ($label)"
  if grep -rnE "${includes[@]}" --exclude='*.generated.*' --exclude-dir=build --exclude-dir=Generated \
    --exclude-dir=.gradle "$SUPPRESSION_PATTERN" "$dir"; then
    failed+=("$label-suppressions")
  fi
}

lint_swift() {
  install_swiftlint
  echo "== SwiftLint $SWIFTLINT_VERSION (mobile/ios)"
  (cd "$IOS_DIR" && "$SWIFTLINT_BIN" lint --strict --quiet --config .swiftlint.yml) || failed+=(swiftlint)
  scan_suppressions swift "$IOS_DIR" '*.swift'
}

analyze_swift() {
  local log="$1"
  [[ -f "$log" ]] || { echo "lint: no xcodebuild log at $log" >&2; exit 2; }
  install_swiftlint
  echo "== SwiftLint $SWIFTLINT_VERSION analyze (mobile/ios)"
  (cd "$IOS_DIR" && "$SWIFTLINT_BIN" analyze --strict --quiet --config .swiftlint.yml \
    --compiler-log-path "$log") || failed+=(swiftlint-analyze)
}

lint_kotlin() {
  local java
  java="$(resolve_java)"
  install_kotlin_tools
  echo "== ktlint $KTLINT_VERSION (mobile/android)"
  (cd "$ANDROID_DIR" && "$java" -jar "$KTLINT_JAR" --relative \
    "**/*.kt" "**/*.kts" "!**/build/**" "!**/.gradle/**" "!**/*.generated.kt") || failed+=(ktlint)
  echo "== detekt $DETEKT_VERSION (mobile/android)"
  (cd "$ANDROID_DIR" && "$java" -jar "$DETEKT_JAR" \
    --config config/detekt.yml --build-upon-default-config \
    --input . --base-path . \
    --excludes "**/build/**,**/.gradle/**,**/*.generated.kt") || failed+=(detekt)
  scan_suppressions kotlin "$ANDROID_DIR" '*.kt' '*.kts'
}

case "${1:-all}" in
  swift) lint_swift ;;
  kotlin) lint_kotlin ;;
  all)
    lint_swift
    lint_kotlin
    ;;
  swift-analyze) analyze_swift "$(cd "$(dirname "${2:?usage: $0 swift-analyze <xcodebuild log>}")" && pwd)/$(basename "$2")" ;;
  *)
    echo "usage: $0 [swift|kotlin|all|swift-analyze <xcodebuild log>]" >&2
    exit 2
    ;;
esac

if ((${#failed[@]} > 0)); then
  echo "lint: findings from ${failed[*]}" >&2
  exit 1
fi
echo "lint: clean"
