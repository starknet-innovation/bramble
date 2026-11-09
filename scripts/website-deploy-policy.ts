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
 *
 * It reads workflows the way GitHub's runner does. Every workflow is parsed
 * with `yaml` under the YAML 1.2 core schema with duplicate keys refused
 * (GitHub refuses them too), never with `Bun.YAML`, which keeps the last of
 * two duplicate keys and types values as YAML 1.1. The workflow this policy
 * judges in full (`website-deploy.yml`, any workflow whose source names the
 * token, any whose decoded document references it, and any holding a line
 * break the parsers disagree on) is read strictly
 * (`workflow-strict-document.ts`): a character allowlist first, then no
 * directive, anchor, alias, tag, merge key, multi-line plain or quoted scalar,
 * folded block or YAML 1.1-ambiguous scalar. The other workflows keep their freedom to use
 * anchors and any printable character; only the four line breaks one parser
 * sees and the other does not (bare CR, U+0085, U+2028, U+2029) pull a
 * workflow into the strict read, because they could hide a binding or a
 * context dump from the scan below. (The mainnet boundary,
 * `mainnet-e2e-boundary.ts`, independently refuses those line breaks and any
 * whole-context or computed secret read in every other workflow; this policy
 * keeps its own checks so the deploy token's rules do not depend on it.)
 *
 * `website-deploy.yml` itself is also pinned to its exact bytes
 * ({@link WEBSITE_DEPLOY_SHA256}, `workflow-source-pin.ts`), so any edit,
 * including one these checks would accept (the dispatch guard's `exit 1`
 * turned into `exit 0`), fails until a reviewed change updates the hash. The
 * pin is applied here, keyed by file name, rather than through the named
 * policies in `workflow-security-policy.ts`: membership there would exempt
 * the workflow from the baseline runner and trigger rules.
 */
import { parseDocument } from "yaml";
import { workflowPath } from "./workflow-policy-text";
import { ANY_SECRET, expressionBodies, secretNames } from "./workflow-secret-references";
import { sourcePinFailures } from "./workflow-source-pin";
import { readWorkflowStrictly, type StrictWorkflow } from "./workflow-strict-document";
import { STRICT_YAML } from "./workflow-yaml-scalars";

/** File name of the workflow that deploys the public website. */
export const WEBSITE_DEPLOY_WORKFLOW = "website-deploy.yml";

/**
 * SHA-256 of the reviewed `.github/workflows/website-deploy.yml` bytes.
 *
 * To update after changing the workflow: review the YAML diff itself (the
 * decoded checks must also pass), then set this to the output of
 * `sha256sum .github/workflows/website-deploy.yml` in the same pull request.
 */
export const WEBSITE_DEPLOY_SHA256 =
  "14efc081b2e5b0711ea515a0753558a069cfd62233b6e4af233b136a9d7a3706";

const PRODUCTION_ENVIRONMENT = "bramble-production";
const DEPLOY_STEP_NAME = "Deploy to Cloudflare Workers";
const TOKEN_NAME = "CLOUDFLARE_API_TOKEN";

// Secret names are not case-sensitive, and neither are expression function
// names, so every test below is case-insensitive by construction.
const NAMES_THE_TOKEN = new RegExp(TOKEN_NAME, "i");
const DUMPS_THE_CONTEXT = /\btoJSON\s*\(\s*secrets\s*\)/i;
// Line breaks YamlDotNet honours and `yaml` reads through inside a comment.
const SPLIT_LINE_BREAK = /\r(?!\n)|[\u0085\u2028\u2029]/;
// A branch filter is a glob when it holds any of these.
const GLOB = /[*?[\]!+]/;

/** One expression that touches the secrets context, and where it sits. */
type SecretUse = {
  readonly path: string;
  readonly namesToken: boolean;
  readonly dumpsContext: boolean;
  /** Reads a secret whose name is computed, so it may be the token. */
  readonly computed: boolean;
};

// Every key and string value is scanned. Only an expression body is examined, so prose in a `run:` script that
// happens to contain the word "secrets" is not a reference. The body is closed
// quote-aware, so a `'}}'` literal cannot end it early.
const collectSecretUses = (node: unknown, path: string, found: SecretUse[]): void => {
  if (typeof node === "string") {
    for (const body of expressionBodies(node)) {
      const names = secretNames(body);
      if (names.length === 0) {
        continue;
      }
      const dumpsContext = DUMPS_THE_CONTEXT.test(body);
      found.push({
        path,
        namesToken: NAMES_THE_TOKEN.test(body),
        dumpsContext,
        computed: !dumpsContext && names.includes(ANY_SECRET),
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
      const child = path === "" ? key : `${path}.${key}`;
      // GitHub evaluates expressions in some mapping keys (an `env` name), so
      // a key is scanned like a value.
      collectSecretUses(key, `${child} (key)`, found);
      collectSecretUses(value, child, found);
    }
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/** The deploy step and the job holding it, located by the step's name. */
type DeployStep = { readonly job: string; readonly index: number };

/**
 * The deploy step: the one place this workflow may bind the Cloudflare token,
 * in its `env`. Returns `null` when that step is absent, which is itself a
 * failure — the binding cannot be checked against a step that does not exist.
 */
const deployStep = (document: unknown): DeployStep | null => {
  for (const [job, body] of Object.entries(record(record(document)["jobs"]))) {
    const steps = record(body)["steps"];
    const index = Array.isArray(steps)
      ? steps.findIndex((step) => record(step)["name"] === DEPLOY_STEP_NAME)
      : -1;
    if (index >= 0) {
      return { job, index };
    }
  }
  return null;
};

// A workflow-text read for every workflow; it refuses what GitHub refuses
// (syntax errors, duplicate keys) and decodes the rest.
const readLeniently = (source: string, unreadable: string): StrictWorkflow => {
  try {
    const document = parseDocument(source, STRICT_YAML);
    if (document.errors.length === 0) {
      return { failures: [], value: document.toJS() };
    }
  } catch {
    // An alias bomb or another undecodable document is unreadable too.
  }
  return { failures: [unreadable], value: undefined };
};

// `on:` may be one event name, a list of names, or a mapping keyed by event.
const eventNames = (on: unknown): unknown[] =>
  Array.isArray(on) ? on : isRecord(on) ? Object.keys(on) : [on];

/**
 * The reviewed deploy job around the token binding: its environment, its
 * triggers, and the dispatch guard, all read from the decoded document.
 */
const deployJobFailures = (document: unknown, deploy: DeployStep, path: string): string[] => {
  const failures: string[] = [];
  const root = record(document);
  const job = record(record(root["jobs"])[deploy.job]);
  const environment = job["environment"];
  const environmentName = isRecord(environment) ? environment["name"] : environment;
  if (environmentName !== PRODUCTION_ENVIRONMENT) {
    failures.push(`${path} must deploy through the reviewed production environment`);
  }
  if (eventNames(root["on"]).some((event) => String(event).startsWith("pull_request"))) {
    failures.push(`${path} must never run on a pull-request revision`);
  }

  // The dispatch guard is a shell condition, so it is matched in the decoded
  // script of an unconditional step before the deploy — but the branch it
  // names is derived from the workflow's own `push` filter, so the two
  // statements of "which branch is production" cannot drift.
  const branches = record(record(root["on"])["push"])["branches"];
  const branch = Array.isArray(branches) && branches.length === 1 ? branches[0] : undefined;
  if (typeof branch !== "string" || branch === "" || GLOB.test(branch)) {
    failures.push(`${path} must trigger on exactly one literal production branch`);
    return failures;
  }
  const guard = `[ "$EVENT_NAME" = "workflow_dispatch" ] && [ "$TRIGGER_REF" != "refs/heads/${branch}" ]`;
  const steps = Array.isArray(job["steps"]) ? job["steps"].slice(0, deploy.index) : [];
  const guarded = steps.map(record).some((step) => {
    const run = step["run"];
    return !Object.hasOwn(step, "if") && typeof run === "string" && run.includes(guard);
  });
  if (!guarded) {
    failures.push(
      `${path} must reject manual runs outside ${branch}, the branch its push filter names`,
    );
  }
  return failures;
};

// The content-selected checks behind websiteDeployFailures.
const contentFailures = (name: string, source: string): readonly string[] => {
  const path = workflowPath(name);
  const unreadable = `${path} must be parseable YAML so its trust boundaries can be checked`;
  const namesToken = NAMES_THE_TOKEN.test(source);
  const strict = name === WEBSITE_DEPLOY_WORKFLOW || namesToken || SPLIT_LINE_BREAK.test(source);
  const read = strict
    ? readWorkflowStrictly(source, path, unreadable)
    : readLeniently(source, unreadable);
  if (read.failures.length > 0) {
    return read.failures;
  }
  const document = read.value;
  // An empty, comment-only, list or scalar root, or a misshapen `jobs`, would
  // otherwise read as an empty workflow with nothing to check.
  const jobs = record(document)["jobs"];
  if (!isRecord(document) || !isRecord(jobs) || !Object.values(jobs).every(isRecord)) {
    return [`${path} must be a mapping with a jobs mapping of job mappings`];
  }

  const uses: SecretUse[] = [];
  collectSecretUses(document, "", uses);

  const failures: string[] = [];
  for (const use of uses) {
    if (use.dumpsContext) {
      failures.push(`${path} must not serialise the whole secrets context (at ${use.path})`);
    }
    if (use.computed) {
      failures.push(`${path} must not read a secret by a computed name (at ${use.path})`);
    }
  }

  const tokenUses = uses.filter((use) => use.namesToken);
  if (tokenUses.length === 0 && !namesToken) {
    return failures;
  }
  // A token reference spelled with escapes selects the workflow only once it
  // is decoded; it must then be read strictly too.
  const strictFailures = strict ? [] : readWorkflowStrictly(source, path, unreadable).failures;
  if (strictFailures.length > 0) {
    return [...failures, ...strictFailures];
  }

  const deploy = deployStep(document);
  if (deploy === null) {
    failures.push(`${path} must keep a step named "${DEPLOY_STEP_NAME}" to bind the token in`);
    return failures;
  }
  const expected = `jobs.${deploy.job}.steps[${deploy.index}].env.${TOKEN_NAME}`;
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
  failures.push(...deployJobFailures(document, deploy, path));
  return failures;
};

/**
 * Every website-deploy policy violation in one workflow source, keyed by the
 * workflow's file name. Safe to run over the whole inventory: a workflow that
 * neither names the Cloudflare credential nor serialises the secrets context
 * yields an empty list, and only `website-deploy.yml` is checked against
 * {@link WEBSITE_DEPLOY_SHA256}. The pin failure is reported alongside the
 * decoded checks, so an edit names the control it breaks as well.
 *
 * The context-dump rule deliberately applies to every workflow, because a dump
 * exposes this credential without naming it — selecting on the name first would
 * return an empty list and leave such a workflow unexamined. A secret read by
 * a computed name (`secrets[format(…)]`) is refused everywhere for the same
 * reason. The workflows this policy reads strictly (see the module comment)
 * yield only the strict reader's failures when they cannot be read exactly.
 */
export const websiteDeployFailures = (name: string, source: string): readonly string[] => [
  ...(name === WEBSITE_DEPLOY_WORKFLOW
    ? sourcePinFailures(
        source,
        workflowPath(name),
        WEBSITE_DEPLOY_SHA256,
        "WEBSITE_DEPLOY_SHA256 in scripts/website-deploy-policy.ts",
      )
    : []),
  ...contentFailures(name, source),
];
