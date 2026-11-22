/**
 * Structural checks on the Sepolia nightly's live steps, read from the parsed
 * YAML rather than their spelling. The text pins in
 * `workflow-sepolia-policy.ts` say what was reviewed; this says it is what
 * GitHub runs. A comment, a blank line or a flow mapping can keep a pin's
 * text in place while a key added to the same step (`shell:`,
 * `working-directory:`) changes what runs with the secret, and a commented-out
 * `concurrency:` line still matches as text.
 *
 * As in the Mainnet E2E policy, the source must first pass the character
 * allowlist and parse under the strict YAML 1.2 core schema, with no duplicate
 * keys, anchors, aliases, tags, merge keys or directives, and no scalar
 * another reader could type differently. Then each live step must decode to
 * exactly its pinned step, once, in the nightly job, and that job must run
 * one at a time. The workflow and the job may carry only their reviewed keys,
 * on its reviewed runner: an added `env` (`BASH_ENV`, `SHELLOPTS`, `PATH`),
 * `defaults`, `container` or `services` changes what the pinned steps run
 * without touching them. Earlier steps can still write `$GITHUB_ENV` or
 * `$GITHUB_PATH`; that stays a review matter.
 */
import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";
import { indirections } from "./mainnet-e2e-workflow-document";
import { record } from "./mainnet-e2e-workflow-shape";
import { sourceCharacterFailures } from "./workflow-source-characters";
import { STRICT_YAML, yamlDifferentialFailures } from "./workflow-yaml-scalars";

/** One live step: its id, its pinned text, and the failures that name it. */
export type PinnedStep = {
  readonly id: string;
  readonly text: string;
  readonly added: string;
  /** Set when the job running this step must not overlap with another run. */
  readonly overlap?: string;
};

/** The job both live steps run in. */
const JOB = "nightly";

/** The nightly job's reviewed concurrency, compared as decoded values. */
const ONE_AT_A_TIME = { "cancel-in-progress": false, group: "sepolia-tx" };

// The only keys the workflow and the nightly job may carry. Anything else at
// either level (env, defaults, container, services) reaches the live steps.
const ROOT_KEYS = ["jobs", "name", "on", "permissions"];
const JOB_KEYS = ["concurrency", "if", "needs", "outputs", "permissions", "runs-on", "steps"];

/** The nightly job's reviewed runner, compared as decoded values. */
const RUNNER = ["codebuild-gha-runner-mc-wallet-${{ github.run_id }}-${{ github.run_attempt }}"];

const onlyKeys = (node: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(node).every((key) => allowed.includes(key));

const pinnedValue = (text: string): unknown => {
  const parsed = parseDocument(text, STRICT_YAML).toJS();
  return Array.isArray(parsed) ? parsed[0] : undefined;
};

const stepsWithId = (jobs: Record<string, unknown>, id: string) =>
  Object.entries(jobs).flatMap(([job, body]) => {
    const steps = record(body)["steps"];
    return Array.isArray(steps)
      ? steps.filter((step) => record(step)["id"] === id).map((step) => ({ job, step }))
      : [];
  });

/**
 * Violations for the live steps in `pinned`, read from `source`. Pure. A
 * source that cannot be read exactly is reported and nothing else is judged,
 * so it never passes.
 */
export const sepoliaDocumentFailures = (
  path: string,
  source: string,
  pinned: readonly PinnedStep[],
): string[] => {
  if (pinned.length === 0) return [];
  const characters = sourceCharacterFailures(source, path);
  if (characters.length > 0) return characters;
  const document = parseDocument(source, STRICT_YAML);
  if (document.errors.length > 0) return [`${path} must parse as YAML with no duplicate keys`];
  if (indirections(document) > 0) {
    return [`${path} must not use YAML anchors, aliases, tags or merge keys`];
  }
  const differentials = yamlDifferentialFailures(source, document, path);
  if (differentials.length > 0) return differentials;
  const root = record(document.toJS());
  const jobs = record(root["jobs"]);
  const job = record(jobs[JOB]);
  const failures: string[] = [];
  for (const step of pinned) {
    const found = stepsWithId(jobs, step.id);
    const only = found.length === 1 ? found[0] : undefined;
    if (only?.job !== JOB || !isDeepStrictEqual(only.step, pinnedValue(step.text))) {
      failures.push(step.added);
    }
    if (step.overlap && !isDeepStrictEqual(job["concurrency"], ONE_AT_A_TIME)) {
      failures.push(step.overlap);
    }
  }
  if (!onlyKeys(root, ROOT_KEYS)) {
    failures.push(`${path} must carry only its reviewed top-level keys`);
  }
  if (!onlyKeys(job, JOB_KEYS) || !isDeepStrictEqual(job["runs-on"], RUNNER)) {
    failures.push(`${path} must run the ${JOB} job only with its reviewed keys and runner`);
  }
  return failures;
};
