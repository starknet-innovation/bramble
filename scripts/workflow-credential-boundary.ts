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
 *   any letter case (a comment included: these names appear nowhere else);
 * - references a confined secret in its decoded document, however escaped,
 *   in any key or string value (the shared scanner);
 * - gives a job a confined environment, matched as GitHub matches it
 *   (trimmed, case-insensitive), whether written as a string or `{name:}`;
 * - gives a job an environment name it cannot check: an expression, or any
 *   character outside `[A-Za-z0-9._-]`.
 * A workflow that does not parse is reported, not skipped. The environments'
 * own protection rules remain the primary control; this is the policy layer
 * in front of them.
 */
import { parseDocument } from "yaml";
import { workflowPath } from "./workflow-policy-text";
import { secretReferences } from "./workflow-secret-references";
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

const record = (value: unknown): Node =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Node) : {};

const covers = (pattern: string, secret: string): boolean =>
  pattern.endsWith("_") ? secret.startsWith(pattern) : secret === pattern;

const owners = (boundary: Boundary): string => boundary.files.join(", ");

const environmentFailures = (path: string, root: Node, foreign: readonly Boundary[]): string[] =>
  Object.entries(record(root["jobs"])).flatMap(([job, body]) => {
    const environment = record(body)["environment"];
    if (environment === undefined) return [];
    const name = typeof environment === "string" ? environment : record(environment)["name"];
    if (typeof name !== "string" || !ENVIRONMENT_NAME.test(name.trim())) {
      return [`${path} job ${job} must name its environment plainly, with no expression`];
    }
    const lower = name.trim().toLowerCase();
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
export const credentialBoundaryFailures = (name: string, source: string): string[] => {
  const path = workflowPath(name);
  const foreign = CREDENTIAL_BOUNDARIES.filter((boundary) => !boundary.files.includes(name));
  const failures: string[] = [];
  const text = source.toUpperCase();
  for (const boundary of foreign) {
    for (const word of [...boundary.secrets, ...boundary.environments]) {
      if (text.includes(word.toUpperCase())) {
        failures.push(`${path} must not name ${word}; only ${owners(boundary)} may`);
      }
    }
  }
  let root: Node;
  try {
    const document = parseDocument(source, STRICT_YAML);
    if (document.errors.length > 0) throw new SyntaxError("unreadable");
    root = record(document.toJS());
  } catch {
    return [...failures, `${path} must parse so its credential boundaries can be checked`];
  }
  for (const { secret } of secretReferences(root)) {
    for (const boundary of foreign.filter((b) => b.secrets.some((s) => covers(s, secret)))) {
      failures.push(`${path} must not reference ${secret}; only ${owners(boundary)} may`);
    }
  }
  failures.push(...environmentFailures(path, root, foreign));
  return [...new Set(failures)];
};
