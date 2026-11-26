/**
 * The reviewed nightly target of the Speculos Ledger E2E workflow
 * (`ledger-e2e.yml`): its first step, which resolves `main` to an immutable
 * commit on a scheduled run, and the checkout that consumes it.
 *
 * Development is trunk-based, so the nightly tests `main`. The step reads
 * `refs/heads/main` anonymously with `git ls-remote` (no step of this workflow
 * may hold the GitHub token), requires an exact match and a full 40-hex commit,
 * and outputs that commit so the checkout is immutable. On every other event
 * it outputs an empty revision and the checkout keeps its default ref.
 *
 * Both steps are pinned exactly, and the resolve step must come first and the
 * checkout second: a resolve after the checkout would leave the checkout on a
 * ref the resolve never verified while looking correct.
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
  'heads="$(git ls-remote --heads "https://github.com/$GITHUB_REPOSITORY.git" \'refs/heads/main\')"',
  'revision="$(printf \'%s\\n\' "$heads" | awk \'$2 == "refs/heads/main" {print $1}\')"',
  'if [ -z "$revision" ]; then',
  '  echo "::error::main does not exist in $GITHUB_REPOSITORY."',
  "  exit 1",
  "fi",
  'if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then',
  '  echo "::error::main did not resolve to an immutable commit."',
  "  exit 1",
  "fi",
  'echo "Resolved: main at $revision"',
  'echo "Nightly Ledger E2E: \\`main\\` at \\`$revision\\`" >> "$GITHUB_STEP_SUMMARY"',
  'echo "revision=$revision" >> "$GITHUB_OUTPUT"',
  "",
].join("\n");

/** The resolve step, exactly: the speculos job's first step. */
export const NIGHTLY_TARGET_STEP = {
  env: {
    EVENT_NAME: `${EXPRESSION} github.event_name }}`,
  },
  id: NIGHTLY_TARGET_ID,
  name: "Resolve the nightly main commit",
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
