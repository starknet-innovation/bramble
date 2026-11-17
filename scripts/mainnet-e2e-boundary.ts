/**
 * The funded mainnet environments and secrets are reachable only from
 * `mainnet-e2e.yml`.
 *
 * Pinning that file's bytes does not stop another workflow from asking for
 * the same environment (GitHub matches environment names case-insensitively)
 * or naming the same secrets. Every other workflow in the inventory is
 * therefore parsed strictly and refused when it:
 * - names an environment containing `mainnet-e2e` (any case, trimmed), or
 *   names one with an expression or any character outside `[A-Za-z0-9._-]`,
 *   which cannot be checked;
 * - references a `MAINNET_E2E_*` secret, or the whole `secrets` context
 *   (`toJSON(secrets)`, a computed index), with the shared scanner;
 * - passes `secrets: inherit`, or calls a reusable workflow other than the
 *   reviewed calls below.
 * A workflow that does not parse strictly, uses a `<<` merge key, or holds a
 * character that YAML readers split lines on differently (bare CR, U+0085,
 * U+2028, U+2029) fails closed instead of being skipped. The environments'
 * own protection rules (required reviewers, `main` only) remain the primary
 * control; this is the policy layer in front of them.
 */
import { isScalar, parseDocument, visit } from "yaml";
import { workflowPath } from "./workflow-policy-text";
import { ANY_SECRET, secretReferences } from "./workflow-secret-references";
import { STRICT_YAML } from "./workflow-yaml-scalars";

/** The workflow allowed to use the mainnet environments and secrets. */
export const MAINNET_E2E_WORKFLOW = "mainnet-e2e.yml";

/** Job-level reusable-workflow calls that are reviewed, by `file:job`. The target has its own named policy. */
const REVIEWED_CALLS: Readonly<Record<string, string>> = {
  "auto-release.yml:release": "./.github/workflows/release-build.yml",
  "release.yml:build-release": "./.github/workflows/release-build.yml",
};

const ENVIRONMENT_NAME = /^[A-Za-z0-9._-]+$/;
const LINE_SPLITTERS = /\r(?!\n)|[\u0085\u2028\u2029]/;

type Node = Record<string, unknown>;

const record = (value: unknown): Node =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Node) : {};

const hasMergeKey = (document: ReturnType<typeof parseDocument>): boolean => {
  let found = false;
  visit(document, {
    Pair(_key, pair) {
      if ((isScalar(pair.key) ? pair.key.value : pair.key) === "<<") found = true;
    },
  });
  return found;
};

const environmentFailure = (path: string, job: string, environment: unknown): string | null => {
  if (environment === undefined) return null;
  const name = typeof environment === "string" ? environment : record(environment)["name"];
  if (typeof name !== "string" || !ENVIRONMENT_NAME.test(name.trim())) {
    return `${path} job ${job} must name its environment plainly, as [A-Za-z0-9._-] with no expression`;
  }
  return name.trim().toLowerCase().includes("mainnet-e2e")
    ? `${path} job ${job} must not use a mainnet E2E environment; only ${MAINNET_E2E_WORKFLOW} may`
    : null;
};

const jobFailures = (name: string, path: string, jobs: Node): string[] =>
  Object.entries(jobs).flatMap(([job, value]) => {
    const body = record(value);
    const failures: string[] = [];
    const environment = environmentFailure(path, job, body["environment"]);
    if (environment !== null) failures.push(environment);
    if (Object.hasOwn(body, "secrets") && typeof body["secrets"] !== "object") {
      failures.push(`${path} job ${job} must not pass secrets: ${String(body["secrets"])}`);
    }
    if (Object.hasOwn(body, "uses") && body["uses"] !== REVIEWED_CALLS[`${name}:${job}`]) {
      failures.push(`${path} job ${job} must not call an unreviewed reusable workflow`);
    }
    return failures;
  });

/**
 * Failures when workflow `name` (any file but {@link MAINNET_E2E_WORKFLOW})
 * could reach the mainnet E2E environments or secrets, or cannot be read
 * strictly enough to tell. Pure: it reads only `source`.
 */
export const mainnetE2eBoundaryFailures = (name: string, source: string): string[] => {
  if (name === MAINNET_E2E_WORKFLOW) return [];
  const path = workflowPath(name);
  if (LINE_SPLITTERS.test(source)) {
    return [`${path} must not contain a bare CR, U+0085, U+2028 or U+2029`];
  }
  const document = parseDocument(source, STRICT_YAML);
  if (document.errors.length > 0 || hasMergeKey(document)) {
    return [
      `${path} must parse strictly, with no duplicate or merge keys, so the mainnet boundary can be checked`,
    ];
  }
  const root = record(document.toJS());
  const failures = jobFailures(name, path, record(root["jobs"]));
  const reached = secretReferences(root).filter(
    ({ secret }) => secret === ANY_SECRET || secret.startsWith("MAINNET_E2E"),
  );
  for (const { secret } of reached) {
    failures.push(
      secret === ANY_SECRET
        ? `${path} must not read the whole secrets context`
        : `${path} must not reference ${secret}; only ${MAINNET_E2E_WORKFLOW} may`,
    );
  }
  return [...new Set(failures)];
};
