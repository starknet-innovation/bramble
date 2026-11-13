#!/usr/bin/env bash
# Dev-only (never CI): copies the named snapshot attachments of an XCUITest result bundle into
# mobile/docs/parity/<screen>-<theme>-<device>.png for side-by-side review with the UI Lab
# captures (design-mobile.md section 3). The folder is git-ignored review material.
#
# Usage: mobile/scripts/mobile-parity-shots.sh path/to/Result.xcresult
set -euo pipefail

RESULT="${1:?usage: mobile-parity-shots.sh <result.xcresult>}"
MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$MOBILE_DIR/docs/parity"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT"
xcrun xcresulttool export attachments --path "$RESULT" --output-path "$TMP" >/dev/null
python3 - "$TMP" "$OUT" <<'PY'
import json, shutil, sys, pathlib
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
count = 0
for test in json.loads((src / "manifest.json").read_text()):
    for item in test["attachments"]:
        name = item.get("suggestedHumanReadableName", "")
        if not name.endswith(".png") or name.startswith("UI Snapshot"):
            continue
        stem = name.rsplit("_", 2)[0]
        shutil.copy(src / item["exportedFileName"], out / f"{stem}.png")
        count += 1
print(f"copied {count} screenshots to {out}")
PY
