/**
 * Trust-boundary policy for the workflow that deploys the public website.
 *
 * It is the only workflow holding a production deploy credential, so its rules
 * live here rather than inside the general workflow policy, which was at its
 * size limit. The rule selects itself from workflow content, so a second
 * workflow that ever references the same credential is checked too.
 */
import { requireText, workflowPath } from "./workflow-policy-text";

const GITHUB_EXPRESSION = "$" + "{{";

// Anchoring the secret to the deploy step's own `env` is the point: a count of
// references alone would accept the expression being hoisted to job-level
// `env`, where checkout, toolchain setup, and the website build would all run
// with the credential in their environment.
const SCOPED_SECRET_STEP = `      - name: Deploy to Cloudflare Workers
        env:
          CLOUDFLARE_API_TOKEN: ${GITHUB_EXPRESSION} secrets.CLOUDFLARE_API_TOKEN }}`;

/**
 * Every website-deploy policy violation in one workflow source, keyed by the
 * workflow's file name. Returns an empty list for any workflow that does not
 * reference the Cloudflare credential, so it is safe to run over the whole
 * inventory.
 *
 * A `workflow_dispatch` may name any ref and executes that ref's revision of
 * the workflow, so the enforcing control against a foreign ref is the
 * deployment environment's branch policy, which GitHub applies before the job
 * starts and no workflow revision can edit. What is pinned here is the half
 * that lives in the tree: the credential reaches exactly one step, and the
 * dispatch guard names the same branch the workflow's own `push` filter does,
 * so the two statements of "which branch is production" cannot drift.
 */
export const websiteDeployFailures = (name: string, source: string): readonly string[] => {
  if (!source.includes("CLOUDFLARE_API_TOKEN")) {
    return [];
  }
  const failures: string[] = [];
  const path = workflowPath(name);
  requireText(
    failures,
    source,
    "    environment:\n      name: bramble-production",
    `${path} must deploy through the reviewed production environment`,
  );
  requireText(
    failures,
    source,
    SCOPED_SECRET_STEP,
    `${path} must bind the Cloudflare token in the deploy step's own env, never job-level env`,
  );
  if (source.split("secrets.CLOUDFLARE_API_TOKEN").length - 1 !== 1) {
    failures.push(`${path} must reference the Cloudflare token exactly once`);
  }
  const branch = source.match(/\n {4}branches: \["([^"]+)"\]/)?.[1];
  if (branch === undefined) {
    failures.push(`${path} must trigger on exactly one literal release branch`);
  } else {
    requireText(
      failures,
      source,
      `[ "$EVENT_NAME" = "workflow_dispatch" ] && [ "$TRIGGER_REF" != "refs/heads/${branch}" ]`,
      `${path} must reject manual runs outside ${branch}, the branch its push filter names`,
    );
  }
  return failures;
};
