/**
 * Policy for the one secret the issue-821 Sepolia verification holds,
 * `BRAMBLE_SEPOLIA_SEEDS`: a testnet-only seed file that still controls the
 * funded test accounts. Split from the general workflow policy, which was at
 * its size limit.
 *
 * Only `nightly.yml` may name it, exactly twice: once as a boolean saying
 * whether it is configured, and once in the environment of the live Sepolia
 * step, which may not write to later steps. Both steps are pinned as text.
 * Every workflow is also refused the forms that hand every secret on at once,
 * and recording a Sepolia tape (network traffic not fit for a public
 * repository). The secrets context ignores case and accepts bracket access, so
 * references are matched in every spelling. This catches drift and careless
 * edits; a determined hostile edit of the workflow is a review matter.
 */
import { requireText, workflowPath } from "./workflow-policy-text";

const GITHUB_EXPRESSION = "$" + "{{";
const REFERENCE = /secrets\s*(?:\.|\[\s*['"])\s*bramble_sepolia_seeds/gi;

const CONFIGURED_STEP = `      - name: Sepolia seeds configured
        id: sepolia_seeds
        env:
          CONFIGURED: ${GITHUB_EXPRESSION} secrets.BRAMBLE_SEPOLIA_SEEDS != '' }}
        run: echo "configured=$CONFIGURED" >> "$GITHUB_OUTPUT"
`;

const LIVE_STEP = `      - name: Sepolia import paths (live)
        id: sepolia
        if: steps.sepolia_seeds.outputs.configured == 'true'
        continue-on-error: true
        env:
          BRAMBLE_SEPOLIA_SEEDS: ${GITHUB_EXPRESSION} secrets.BRAMBLE_SEPOLIA_SEEDS }}
`;

/**
 * Returns the Sepolia-secret policy violations in one workflow's source. Pure:
 * it reads only the text it is given.
 */
export const sepoliaSeedsFailures = (name: string, source: string): string[] => {
  const path = workflowPath(name);
  const failures = ["toJSON(secrets)", "secrets: inherit", "BRAMBLE_SEPOLIA_RECORD"]
    .filter((form) => source.includes(form))
    .map((form) => `${path} must not use ${form}`);
  const uses = source.match(REFERENCE)?.length ?? 0;
  if (uses === 0) return failures;
  if (name !== "nightly.yml") {
    return [...failures, `${path} must not reference the Sepolia seed secret`];
  }
  requireText(
    failures,
    source,
    CONFIGURED_STEP,
    `${path} must check the Sepolia seeds only as a boolean`,
  );
  requireText(
    failures,
    source,
    LIVE_STEP,
    `${path} must scope the Sepolia seeds to its live Sepolia step`,
  );
  if (uses !== 2) failures.push(`${path} must reference the Sepolia seed secret exactly twice`);
  const at = source.indexOf(LIVE_STEP);
  const step = at < 0 ? "" : source.slice(at, source.indexOf("\n      - ", at + 1));
  if (/GITHUB_(?:ENV|OUTPUT|PATH|STEP_SUMMARY)/.test(step)) {
    failures.push(`${path} must not let the live Sepolia step write to later steps`);
  }
  return failures;
};
