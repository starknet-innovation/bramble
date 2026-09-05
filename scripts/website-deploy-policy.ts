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

// GitHub Actions treats `secrets.NAME` and `secrets['NAME']` as the same
// access, with arbitrary whitespace and either quote style. Counting one
// spelling is what let the previous version of this rule pass while a second
// reference in bracket form hoisted the credential to job-level `env` — the
// exact exposure the count exists to catch, in a different notation.
const SECRET_REFERENCE =
  /secrets\s*(?:\.\s*CLOUDFLARE_API_TOKEN\b|\[\s*(['"])CLOUDFLARE_API_TOKEN\1\s*\])/g;

// `toJSON(secrets)` serialises every secret in the context into one expression,
// so it exposes the token while naming nothing a per-secret count could match.
const SECRETS_CONTEXT_DUMP = /toJSON\s*\(\s*secrets\s*\)/;

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
 *
 * The reference count matches every notation GitHub accepts, not one literal.
 * A rule that reads `secrets.NAME` alone is bypassed by `secrets['NAME']`, and
 * both are bypassed by `toJSON(secrets)`. A gate with a known bypass is worse
 * than no gate, because it implies a guarantee it does not provide.
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
  // Match on every spelling of the reference rather than on one literal, so a
  // second reference cannot hide behind a notation the rule does not read.
  if ((source.match(SECRET_REFERENCE) ?? []).length !== 1) {
    failures.push(
      `${path} must reference the Cloudflare token exactly once, in any accepted spelling`,
    );
  }
  if (SECRETS_CONTEXT_DUMP.test(source)) {
    failures.push(`${path} must not serialise the whole secrets context`);
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
