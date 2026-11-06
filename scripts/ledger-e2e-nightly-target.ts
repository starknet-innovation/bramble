/**
 * The reviewed nightly target of the Speculos Ledger E2E workflow
 * (`ledger-e2e.yml`): its first step, which resolves the active release
 * branch on a scheduled run, and the checkout that consumes it.
 *
 * A scheduled run uses the workflow on the default branch. Without this step
 * it would test `main`, not the release being shipped. The step resolves the
 * branch as `nightly.yml` does (`vars.ACTIVE_RELEASE_BRANCH`, else the highest
 * `release/vX.Y[.Z]`), requires the exact release pattern and an existing
 * branch, and outputs the commit that branch pointed at, so the checkout is
 * immutable. It reads the branches anonymously with `git ls-remote` because no
 * step of this workflow may hold the GitHub token. On every other event it
 * outputs an empty revision and the checkout keeps its default ref.
 *
 * Both steps are pinned exactly, and the resolve step must come first and the
 * checkout second: a resolve after the checkout would leave a scheduled run
 * testing `main` while looking correct.
 */

/** Step id whose `revision` output the speculos job's checkout consumes. */
export const NIGHTLY_TARGET_ID = "target";

const EXPRESSION = "$" + "{{";

/** The resolve step's exact script, as GitHub receives it. */
export const NIGHTLY_TARGET_SCRIPT = [
  "set -euo pipefail",
  'if [ "$EVENT_NAME" != "schedule" ]; then',
  '  echo "revision=" >> "$GITHUB_OUTPUT"',
  "  exit 0",
  "fi",
  'heads="$(git ls-remote --heads "https://github.com/$GITHUB_REPOSITORY.git" \'refs/heads/release/*\')"',
  'if [ -n "${ACTIVE_RELEASE_BRANCH:-}" ]; then',
  '  echo "Using vars.ACTIVE_RELEASE_BRANCH: $ACTIVE_RELEASE_BRANCH"',
  '  candidate="$ACTIVE_RELEASE_BRANCH"',
  "else",
  '  echo "Auto-resolving the highest-semver release/* branch ..."',
  "  branches=\"$(printf '%s\\n' \"$heads\" | awk '{print $2}' | sed 's#^refs/heads/##' | grep -E '^release/v[0-9]+\\.[0-9]+(\\.[0-9]+)?$' || true)\"",
  '  if [ -z "$branches" ]; then',
  '    echo "::error::No release/* branch exists and vars.ACTIVE_RELEASE_BRANCH is unset."',
  "    exit 1",
  "  fi",
  "  best=\"$(printf '%s\\n' \"$branches\" | sed 's#^release/v##' | sort -V | tail -1)\"",
  '  candidate="release/v$best"',
  "fi",
  'if [[ ! "$candidate" =~ ^release/v[0-9]+\\.[0-9]+(\\.[0-9]+)?$ ]]; then',
  '  echo "::error::Nightly branch must match release/vX.Y or release/vX.Y.Z exactly."',
  "  exit 1",
  "fi",
  'revision="$(printf \'%s\\n\' "$heads" | awk -v ref="refs/heads/$candidate" \'$2 == ref {print $1}\')"',
  'if [ -z "$revision" ]; then',
  "  echo \"::error::Nightly branch '$candidate' does not exist in $GITHUB_REPOSITORY.\"",
  "  exit 1",
  "fi",
  'if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then',
  '  echo "::error::Nightly branch did not resolve to an immutable commit."',
  "  exit 1",
  "fi",
  'echo "Resolved: $candidate at $revision"',
  'echo "Nightly Ledger E2E: \\`$candidate\\` at \\`$revision\\`" >> "$GITHUB_STEP_SUMMARY"',
  'echo "revision=$revision" >> "$GITHUB_OUTPUT"',
  "",
].join("\n");

/** The resolve step, exactly: the speculos job's first step. */
export const NIGHTLY_TARGET_STEP = {
  env: {
    ACTIVE_RELEASE_BRANCH: `${EXPRESSION} vars.ACTIVE_RELEASE_BRANCH }}`,
    EVENT_NAME: `${EXPRESSION} github.event_name }}`,
  },
  id: NIGHTLY_TARGET_ID,
  name: "Resolve the nightly release commit",
  run: NIGHTLY_TARGET_SCRIPT,
} as const;

/** The checkout action the speculos job must use, pinned by commit (v7.0.1). */
export const NIGHTLY_TARGET_CHECKOUT_USES =
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";

/** The speculos job's checkout inputs: no stored token, the resolved commit. */
export const NIGHTLY_TARGET_CHECKOUT_WITH = {
  "persist-credentials": false,
  ref: `${EXPRESSION} steps.${NIGHTLY_TARGET_ID}.outputs.revision }}`,
} as const;
