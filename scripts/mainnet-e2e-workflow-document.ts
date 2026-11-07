/**
 * Structural checks on the Mainnet E2E workflow, read from the parsed YAML
 * document rather than its spelling.
 *
 * A text match can be kept in place while it stops applying: a plain scalar
 * continued on the next line, a block scalar, a flow mapping, a comment, an
 * alias or a duplicate key all change what GitHub executes without removing
 * the matched text. Here the raw source must first pass a character
 * allowlist (`workflow-source-characters.ts`); the workflow is then parsed
 * under the YAML 1.2 core
 * schema with duplicate keys refused and merge keys left literal; anchors,
 * aliases, explicit tags and `<<` keys are refused anywhere in it; any
 * directive, and any scalar another YAML reader could type differently, is
 * refused (`workflow-yaml-scalars.ts`); and the decoded values are compared.
 * Anything the parser reports fails closed.
 *
 * Uses the `yaml` package rather than `Bun.YAML`, which silently keeps the
 * last of two duplicate keys and resolves aliases and merge keys, so neither
 * can be detected after parsing.
 */

import { isAlias, isScalar, parseDocument, visit } from "yaml";
import { EXECUTE_CONDITION, jobFailures, rootFailures } from "./mainnet-e2e-workflow-jobs";
import { mainnetE2eSecretFailures } from "./mainnet-e2e-workflow-secrets";
import { isRecord, record } from "./mainnet-e2e-workflow-shape";
import { sourceCharacterFailures } from "./workflow-source-characters";
import { STRICT_YAML, yamlDifferentialFailures } from "./workflow-yaml-scalars";

const PATH = ".github/workflows/mainnet-e2e.yml";

/** The exact `if:` the gasless step must carry, compared as a decoded string. */
export const GASLESS_CONDITION =
  "steps.secrets.outcome == 'success' && steps.playwright.outcome != 'failure'";

/** Failure text when the gasless step or its condition is not the reviewed one. */
export const GASLESS_CONDITION_FAILURE =
  "mainnet execution must run the gasless send only after the secrets step passed";

/** Which environment each secret-holding job reads; any other job reads none. */
const ENVIRONMENTS: Readonly<Record<string, string>> = {
  execute: "mainnet-e2e",
  post: "mainnet-e2e-balance",
  preflight: "mainnet-e2e-balance",
};

// A job `if:` that calls a status function runs even when the jobs it needs
// failed or were cancelled.
const STATUS_FUNCTION = /\b(?:always|cancelled|failure)\s*\(/;

type Node = Record<string, unknown>;

/** Anchors, aliases, explicit tags and `<<` merge keys anywhere in the document. */
const indirections = (document: ReturnType<typeof parseDocument>): number => {
  let found = 0;
  visit(document, {
    Node(_key, node) {
      const explicit = (key: "anchor" | "tag"): boolean => key in node && node[key] !== undefined;
      if (isAlias(node) || explicit("anchor") || explicit("tag")) found += 1;
    },
    Pair(_key, pair) {
      const key = isScalar(pair.key) ? pair.key.value : pair.key;
      if (key === "<<") found += 1;
    },
  });
  return found;
};

/** Every step in every job, with the id of the job it belongs to. */
const allSteps = (jobs: Node): { readonly job: string; readonly step: Node }[] =>
  Object.entries(jobs).flatMap(([job, body]) => {
    const steps = record(body)["steps"];
    return Array.isArray(steps) ? steps.map((step) => ({ job, step: record(step) })) : [];
  });

/**
 * Violations of the controls this module reads structurally. `source` is the
 * workflow text; nothing is read from disk. A parse error, a duplicate key, or
 * any anchor, alias or merge key is reported and the remaining checks are
 * skipped, so a document that cannot be read exactly never passes.
 */
export const mainnetE2eDocumentFailures = (source: string): string[] => {
  // Before any parsing: a character the parsers split lines on differently
  // could hide a step or a directive from everything below.
  const characters = sourceCharacterFailures(source, PATH);
  if (characters.length > 0) return characters;
  const document = parseDocument(source, STRICT_YAML);
  if (document.errors.length > 0) {
    return [`${PATH} must parse as YAML with no duplicate keys`];
  }
  if (indirections(document) > 0) {
    return [`${PATH} must not use YAML anchors, aliases, tags or merge keys`];
  }
  // A value GitHub could type differently from this parser is never compared.
  const differentials = yamlDifferentialFailures(source, document, PATH);
  if (differentials.length > 0) return differentials;
  const root = record(document.toJS());
  const jobs = record(root["jobs"]);
  const failures = [...rootFailures(root), ...jobFailures(jobs), ...mainnetE2eSecretFailures(root)];
  const condition = record(jobs["execute"])["if"];
  if (typeof condition !== "string" || STATUS_FUNCTION.test(condition)) {
    failures.push("mainnet execution must not run after a failed or cancelled job it needs");
  }
  if (condition !== EXECUTE_CONDITION) {
    failures.push("mainnet execution must keep its reviewed job condition");
  }
  for (const [job, body] of Object.entries(jobs)) {
    const environment = record(body)["environment"];
    const expected = ENVIRONMENTS[job];
    const name = isRecord(environment) ? environment["name"] : environment;
    const keys = isRecord(environment) ? Object.keys(environment) : [];
    if (
      expected === undefined ? environment !== undefined : name !== expected || keys.length !== 1
    ) {
      failures.push(`the ${job} job must use only its reviewed environment`);
    }
  }
  const gasless = allSteps(jobs).filter(({ step }) => step["id"] === "gasless");
  const only = gasless.length === 1 ? gasless[0] : undefined;
  if (only?.job !== "execute" || only.step["if"] !== GASLESS_CONDITION) {
    failures.push(GASLESS_CONDITION_FAILURE);
  }
  return [...new Set(failures)];
};
