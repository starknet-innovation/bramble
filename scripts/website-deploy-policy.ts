/**
 * Trust-boundary policy for the workflow that deploys the public website.
 *
 * It is the only workflow holding a production deploy credential, so its rules
 * live here rather than inside the general workflow policy, which was at its
 * size limit.
 *
 * The credential rules are **structural**: the workflow is parsed and every
 * expression touching the `secrets` context is located by its path in the
 * document. Four bypasses reached the earlier text-matching version — hoisting
 * the reference to job-level `env`, writing it as `secrets['NAME']`, writing the
 * name in lower case, and `toJSON(secrets)` in a workflow that never named the
 * credential at all. Every one was the same error: matching a notation instead
 * of a position, in a syntax that admits many notations. Parsing removes
 * notation from the question. Where a value sits is not a matter of spelling.
 *
 * It fails closed. A workflow that cannot be parsed is reported rather than
 * skipped, because a gate that cannot read a file must never conclude it is
 * safe.
 */
import { forbidText, requireText, workflowPath } from "./workflow-policy-text";

const PRODUCTION_ENVIRONMENT = "bramble-production";
const DEPLOY_STEP_NAME = "Deploy to Cloudflare Workers";
const TOKEN_NAME = "CLOUDFLARE_API_TOKEN";

// A GitHub Actions expression. Only its body is examined, so prose in a `run:`
// script that happens to contain the word "secrets" is not a reference.
const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g;
// Secret names are not case-sensitive, and neither are expression function
// names, so every test below is case-insensitive by construction.
const USES_SECRETS = /\bsecrets\b/i;
const NAMES_THE_TOKEN = new RegExp(TOKEN_NAME, "i");
const DUMPS_THE_CONTEXT = /\btoJSON\s*\(\s*secrets\s*\)/i;

/** One expression that touches the secrets context, and where it sits. */
type SecretUse = {
  readonly path: string;
  readonly namesToken: boolean;
  readonly dumpsContext: boolean;
};

const collectSecretUses = (node: unknown, path: string, found: SecretUse[]): void => {
  if (typeof node === "string") {
    for (const match of node.matchAll(EXPRESSION)) {
      const body = match[1] ?? "";
      if (!USES_SECRETS.test(body)) {
        continue;
      }
      found.push({
        path,
        namesToken: NAMES_THE_TOKEN.test(body),
        dumpsContext: DUMPS_THE_CONTEXT.test(body),
      });
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      collectSecretUses(item, `${path}[${index}]`, found);
    }
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      collectSecretUses(value, path === "" ? key : `${path}.${key}`, found);
    }
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The document path at which this workflow may bind the Cloudflare token: the
 * `env` of the deploy step itself. Returns `null` when that step is absent,
 * which is itself a failure — the binding cannot be checked against a step that
 * does not exist.
 */
const allowedTokenPath = (document: unknown): string | null => {
  const jobs = isRecord(document) && isRecord(document["jobs"]) ? document["jobs"] : null;
  if (!jobs) {
    return null;
  }
  for (const [jobName, job] of Object.entries(jobs)) {
    const steps = isRecord(job) && Array.isArray(job["steps"]) ? job["steps"] : null;
    if (!steps) {
      continue;
    }
    for (const [index, step] of steps.entries()) {
      if (isRecord(step) && step["name"] === DEPLOY_STEP_NAME) {
        return `jobs.${jobName}.steps[${index}].env.${TOKEN_NAME}`;
      }
    }
  }
  return null;
};

/**
 * Every website-deploy policy violation in one workflow source, keyed by the
 * workflow's file name. Safe to run over the whole inventory: a workflow that
 * neither names the Cloudflare credential nor serialises the secrets context
 * yields an empty list.
 *
 * The context-dump rule deliberately applies to every workflow, because a dump
 * exposes this credential without naming it — selecting on the name first would
 * return an empty list and leave such a workflow unexamined.
 */
export const websiteDeployFailures = (name: string, source: string): readonly string[] => {
  const failures: string[] = [];
  const path = workflowPath(name);

  let document: unknown;
  try {
    document = Bun.YAML.parse(source);
  } catch {
    failures.push(`${path} must be parseable YAML so its trust boundaries can be checked`);
    return failures;
  }

  const uses: SecretUse[] = [];
  collectSecretUses(document, "", uses);

  for (const use of uses) {
    if (use.dumpsContext) {
      failures.push(`${path} must not serialise the whole secrets context (at ${use.path})`);
    }
  }

  const tokenUses = uses.filter((use) => use.namesToken);
  if (tokenUses.length === 0 && !NAMES_THE_TOKEN.test(source)) {
    return failures;
  }

  const expected = allowedTokenPath(document);
  if (expected === null) {
    failures.push(`${path} must keep a step named "${DEPLOY_STEP_NAME}" to bind the token in`);
    return failures;
  }
  for (const use of tokenUses) {
    if (use.path !== expected) {
      failures.push(
        `${path} must bind the Cloudflare token only at ${expected}, not at ${use.path}`,
      );
    }
  }
  if (!tokenUses.some((use) => use.path === expected)) {
    failures.push(`${path} must bind the Cloudflare token at ${expected}`);
  }

  requireText(
    failures,
    source,
    `    environment:\n      name: ${PRODUCTION_ENVIRONMENT}`,
    `${path} must deploy through the reviewed production environment`,
  );
  forbidText(
    failures,
    source,
    "\n  pull_request",
    `${path} must never run on a pull-request revision`,
  );

  // The dispatch guard is a shell condition, so it is matched as text — but the
  // branch it names is derived from the workflow's own `push` filter, so the two
  // statements of "which branch is production" cannot drift.
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
