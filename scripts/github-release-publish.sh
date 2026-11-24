#!/usr/bin/env bash
# Publish one Bramble release without replacing assets.
#
# The release workflow inlines this file into a job that does not check out
# the tag. A test fails if the two copies drift. The job creates a draft,
# uploads only assets that are not already there, compares those bytes with
# the build, and publishes. GitHub's immutable-release rules then freeze the
# assets and the tag. If this run published the release and `gh release verify`
# does not succeed, the release is deleted when GitHub still allows it and the
# tag is left in place. An already published release is left untouched.
set -euo pipefail
shopt -s nullglob

if [[ ! "${TAG:-}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::Release tag must match vX.Y.Z exactly."
  exit 1
fi

ARTIFACT_DIR="${ARTIFACT_DIR:-artifacts}"

note() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'published_now=%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
}

refresh_state() {
  local draft
  if draft="$(gh release view "$TAG" --json isDraft --jq .isDraft 2>/dev/null)"; then
    if [ "$draft" = "true" ]; then
      state=draft
    else
      state=published
    fi
  else
    state=missing
  fi
}

asset_present() {
  # A pipe into `grep -q` closes early and, with pipefail, looks like a miss.
  local names
  names="$(gh release view "$TAG" --json assets --jq '.assets[].name')"
  [[ $'\n'"${names}"$'\n' == *$'\n'"$1"$'\n'* ]]
}

upload_missing() {
  local file name
  local missing=()
  for file in "$ARTIFACT_DIR"/*.zip "$ARTIFACT_DIR"/*.zip.sha256; do
    name="$(basename "$file")"
    if asset_present "$name"; then
      echo "Leaving existing asset ${name} in place."
    else
      missing+=("$file")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    gh release upload "$TAG" "${missing[@]}"
  fi
}

download_assets() {
  rm -rf "$1"
  mkdir -p "$1"
  gh release download "$TAG" --dir "$1" --pattern 'bramble-*.zip' --pattern 'bramble-*.zip.sha256'
}

compare_assets() {
  local actual="$1"
  local file name count=0
  local chromium=("$ARTIFACT_DIR"/bramble-[0-9]*.zip)
  local firefox=("$ARTIFACT_DIR"/bramble-firefox-*.zip)
  if [ "${#chromium[@]}" -ne 1 ] || [ "${#firefox[@]}" -ne 1 ]; then
    echo "::error::Expected one Chromium zip and one Firefox zip."
    exit 1
  fi
  for file in "$ARTIFACT_DIR"/*.zip "$ARTIFACT_DIR"/*.zip.sha256; do
    name="$(basename "$file")"
    if [ ! -f "$actual/$name" ] || ! cmp -s "$file" "$actual/$name"; then
      echo "::error::Release asset ${name} does not match the built bytes. Refusing to replace it."
      exit 1
    fi
    count=$((count + 1))
  done
  if [ "$count" -ne 4 ]; then
    echo "::error::Expected both zips and both checksums, compared ${count} files."
    exit 1
  fi
  (
    cd "$actual"
    sha256sum -c ./*.zip.sha256
  )
}

verify_published() {
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if gh release verify "$TAG" \
      && gh release verify-asset "$TAG" "$1" \
      && gh release verify-asset "$TAG" "$2"; then
      return 0
    fi
    echo "Release attestation for ${TAG} is not ready (attempt ${attempt})."
    sleep "${VERIFY_RETRY_SECONDS:-10}"
  done
  return 1
}

checksums=("$ARTIFACT_DIR"/*.zip.sha256)
if [ "${#checksums[@]}" -ne 2 ]; then
  echo "::error::Expected Chromium and Firefox checksums in ${ARTIFACT_DIR}."
  exit 1
fi
(
  cd "$ARTIFACT_DIR"
  sha256sum -c ./*.zip.sha256
)

chromium=("$ARTIFACT_DIR"/bramble-[0-9]*.zip)
firefox=("$ARTIFACT_DIR"/bramble-firefox-*.zip)
if [ "${#chromium[@]}" -ne 1 ] || [ "${#firefox[@]}" -ne 1 ]; then
  echo "::error::Expected one Chromium zip and one Firefox zip."
  exit 1
fi

state=missing
refresh_state
if [ "$state" = "missing" ]; then
  if ! gh release create "$TAG" \
    --draft \
    --title "$TAG" \
    --notes-file "$ARTIFACT_DIR/release-notes.md" \
    --verify-tag; then
    echo "gh release create did not create ${TAG}; continuing if a release now exists."
  fi
  refresh_state
fi

if [ "$state" = "missing" ]; then
  echo "::error::Release ${TAG} does not exist."
  exit 1
fi

if [ "$state" = "published" ]; then
  download_assets published-assets
  compare_assets published-assets
  note false
  echo "Release ${TAG} is already published and its assets match. Leaving it unchanged."
  exit 0
fi

upload_missing
download_assets draft-assets
compare_assets draft-assets
gh release edit "$TAG" --draft=false
download_assets published-assets
compare_assets published-assets

if ! verify_published "${chromium[0]}" "${firefox[0]}"; then
  echo "::error::Release ${TAG} was published but its attestation did not verify. Deleting it when GitHub still allows deletion. Enable immutable releases under Settings, General, Releases, then re-run. The tag is left in place."
  gh release delete "$TAG" --yes || echo "Could not delete ${TAG}."
  exit 1
fi

note true
echo "Published ${TAG}."
