/**
 * Each protected deploy credential and environment is reachable only from
 * the workflow file that uses it today.
 *
 * A workflow's own policy pins how its credential is bound, but a pin or a
 * shape check on one file does not stop a new file from copying that shape
 * under another name: a `copy.yml` with the reviewed "Deploy to Cloudflare
 * Workers" step would receive the production token with any other steps
 * beside it. Like the mainnet boundary (`mainnet-e2e-boundary.ts`), this
 * module keys each credential to exact file names. Every other workflow is
 * refused when it:
 * - names a confined secret or environment anywhere in its source text, in
 *   any letter case (a comment included: these names appear nowhere else),
 *   or in any decoded key or string value, however escaped (a reusable
 *   call's `secrets:` or `with:`, a matrix value, an output);
 * - references a confined secret in its decoded document, in any key or
 *   string value (the shared scanner), or reads the whole `secrets` context
 *   or a computed name, or passes `secrets: inherit`: each of these reaches
 *   every confined secret;
 * - gives a job a confined environment, matched as GitHub matches it
 *   (trimmed, case-insensitive), whether written as a string or `{name:}`;
 * - gives a job an environment name it cannot check: an expression, or any
 *   character outside `[A-Za-z0-9._-]` (surrounding spaces included).
 * Even an owner file may not pass a confined secret to a reusable workflow
 * through a job's `secrets:` or `with:`; no reviewed call does today. A
 * workflow that does not parse, or whose root, `jobs` or job bodies are not
 * mappings, is reported, not skipped. The environments'
 * own protection rules remain the primary control; this is the policy layer
 * in front of them.
 */
import { parseDocument } from "yaml";
import { workflowPath } from "./workflow-policy-text";
import { ANY_SECRET, documentStrings, secretReferences } from "./workflow-secret-references";
import { STRICT_YAML } from "./workflow-yaml-scalars";

/** One credential boundary: the files allowed to hold it, and what it covers. */
type Boundary = {
  readonly files: readonly string[];
  /** Upper-case secret names; a name ending in `_` covers every secret with that prefix. */
  readonly secrets: readonly string[];
  /** Lower-case environment names. */
  readonly environments: readonly string[];
};

/**
 * The confined credentials, each legal in exactly the files that use it
 * today. Changing a row widens or narrows who may hold a credential, so it
 * needs the same review as the workflow itself.
 */
export const CREDENTIAL_BOUNDARIES: readonly Boundary[] = [
  // The production website deploy token.
  {
    files: ["website-deploy.yml"],
    secrets: ["CLOUDFLARE_API_TOKEN"],
    environments: ["bramble-production"],
  },
  // Chrome Web Store publishing.
  { files: ["release.yml"], secrets: ["CWS_"], environments: ["chrome-web-store"] },
  // UI Lab: the Chromatic project token and the Pages deployment.
  { files: ["ui-lab.yml"], secrets: ["CHROMATIC_PROJECT_TOKEN"], environments: ["github-pages"] },
  // The Sepolia seed file, which still controls funded testnet accounts.
  { files: ["nightly.yml"], secrets: ["BRAMBLE_SEPOLIA_SEEDS"], environments: [] },
];

const ENVIRONMENT_NAME = /^[A-Za-z0-9._-]+$/;

type Node = Record<string, unknown>;

const isRecord = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown): Node => (isRecord(value) ? value : {});

const covers = (pattern: string, secret: string): boolean =>
  pattern.endsWith("_") ? secret.startsWith(pattern) : secret === pattern;

const owners = (boundary: Boundary): string => boundary.files.join(", ");

const environmentFailures = (path: string, root: Node, foreign: readonly Boundary[]): string[] =>
  Object.entries(record(root["jobs"])).flatMap(([job, body]) => {
    const environment = record(body)["environment"];
    if (environment === undefined) return [];
    const name = typeof environment === "string" ? environment : record(environment)["name"];
    // The decoded name as written: GitHub trims it, so a padded name is refused
    // rather than compared.
    if (typeof name !== "string" || !ENVIRONMENT_NAME.test(name)) {
      return [`${path} job ${job} must name its environment plainly, with no expression`];
    }
    const lower = name.toLowerCase();
    return foreign
      .filter((boundary) => boundary.environments.includes(lower))
      .map(
        (boundary) =>
          `${path} job ${job} must not use the ${lower} environment; only ${owners(boundary)} may`,
      );
  });

/**
 * Failures when workflow `name` could reach a credential or environment
 * confined to other files by {@link CREDENTIAL_BOUNDARIES}, or cannot be read
 * well enough to tell. Pure: it reads only `source`.
 */
// Whether `value` is a workflow root with a `jobs` mapping of job mappings.
const isWorkflowShape = (value: unknown): value is Node =>
  isRecord(value) && isRecord(value["jobs"]) && Object.values(value["jobs"]).every(isRecord);

const nameFailures = (path: string, texts: readonly string[], foreign: readonly Boundary[]) =>
  foreign.flatMap((boundary) =>
    [...boundary.secrets, ...boundary.environments]
      .filter((word) => texts.some((text) => text.toUpperCase().includes(word.toUpperCase())))
      .map((word) => `${path} must not name ${word}; only ${owners(boundary)} may`),
  );

// A reusable-workflow call may not hand any confined secret on, even from
// its owner file: no reviewed call does.
const callFailures = (path: string, jobs: Node): string[] =>
  Object.entries(jobs).flatMap(([job, body]) => {
    const passed = Object.hasOwn(record(body), "uses")
      ? secretReferences([record(body)["secrets"], record(body)["with"]])
      : [];
    return passed
      .filter(({ secret }) =>
        CREDENTIAL_BOUNDARIES.some((b) => b.secrets.some((s) => covers(s, secret))),
      )
      .map(({ secret }) => `${path} job ${job} must not pass ${secret} to a reusable workflow`);
  });

const contextFailures = (path: string, root: Node, jobs: Node): string[] => {
  const failures: string[] = [];
  if (secretReferences(root).some(({ secret }) => secret === ANY_SECRET)) {
    failures.push(
      `${path} must not read the whole secrets context or a computed secret name; it holds confined credentials`,
    );
  }
  for (const [job, body] of Object.entries(jobs)) {
    if (typeof record(body)["secrets"] === "string") {
      failures.push(`${path} job ${job} must not pass secrets: ${String(record(body)["secrets"])}`);
    }
  }
  return failures;
};

/**
 * Failures when workflow `name` could reach a credential or environment
 * confined to other files by {@link CREDENTIAL_BOUNDARIES}, or cannot be read
 * well enough to tell. Pure: it reads only `source`.
 */
export const credentialBoundaryFailures = (name: string, source: string): string[] => {
  const path = workflowPath(name);
  const foreign = CREDENTIAL_BOUNDARIES.filter((boundary) => !boundary.files.includes(name));
  const failures = nameFailures(path, [source], foreign);
  let root: unknown;
  try {
    const document = parseDocument(source, STRICT_YAML);
    if (document.errors.length > 0) throw new SyntaxError("unreadable");
    root = document.toJS();
  } catch {
    return [...failures, `${path} must parse so its credential boundaries can be checked`];
  }
  if (!isWorkflowShape(root)) {
    return [...failures, `${path} must be a mapping with a jobs mapping of job mappings`];
  }
  const jobs = record(root["jobs"]);
  failures.push(
    ...nameFailures(
      path,
      documentStrings(root).map(({ text }) => text),
      foreign,
    ),
  );
  for (const { secret } of secretReferences(root)) {
    for (const boundary of foreign.filter((b) => b.secrets.some((s) => covers(s, secret)))) {
      failures.push(`${path} must not reference ${secret}; only ${owners(boundary)} may`);
    }
  }
  failures.push(
    ...contextFailures(path, root, jobs),
    ...callFailures(path, jobs),
    ...environmentFailures(path, root, foreign),
  );
  return [...new Set(failures)];
};

/** Workflows whose exact bytes a policy pins; each must exist, or its pin is silently gone. */
export const PINNED_WORKFLOWS: readonly string[] = ["ledger-e2e.yml", "website-deploy.yml"];

/**
 * A failure for each of {@link PINNED_WORKFLOWS} missing from `sources`,
 * independent of which named policies exist. Pure.
 */
export const pinnedWorkflowPresenceFailures = (sources: Readonly<Record<string, string>>) =>
  PINNED_WORKFLOWS.filter((file) => !Object.hasOwn(sources, file)).map(
    (file) => `${workflowPath(file)} is missing; its exact-bytes pin cannot be enforced`,
  );
