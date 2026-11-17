/**
 * The Ledger E2E workflow's named controls, read from the decoded document.
 *
 * These were once matched as text in the workflow source, where a control
 * could sit in a comment or a dead step while GitHub ran something else. Each
 * is now a statement about the decoded value GitHub executes, and each keeps
 * its own failure, so a diff that drops one is told which control went. The
 * exact-shape comparison in `ledger-e2e-workflow-document.ts` would reject
 * most of these edits too, only with a less specific message.
 */
import { documentStrings } from "./workflow-secret-references";

type Node = Record<string, unknown>;

const isRecord = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `value` when it is a mapping, else an empty one, so a wrong shape reads as missing. */
export const record = (value: unknown): Node => (isRecord(value) ? value : {});

// Key order is not meaning in YAML; arrays keep their order.
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : isRecord(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;

/** Whether two decoded values are equal, ignoring mapping key order. */
export const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

const E = "$" + "{{";
const SUITE = "BRAMBLE_SPECULOS_REQUIRED=1 bun run test:e2e:ledger";
const REQUIRE_HASHES = "bun run scripts/ledger-app-hashes.ts require nanosp flex";
const RECORD_HASHES = 'bun run scripts/ledger-app-hashes.ts record | tee -a "$GITHUB_STEP_SUMMARY"';
const SPECULOS_IF = `${E} !inputs.record_hashes }}`;
const RECORD_IF = "github.event_name == 'workflow_dispatch' && inputs.record_hashes";
const UPLOAD_STEP = {
  uses: "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9",
  if: "failure()",
  with: {
    name: "ledger-e2e-traces",
    path: "test-results/",
    "retention-days": 7,
    "if-no-files-found": "ignore",
  },
};
const PRIVILEGED_EVENTS = ["pull_request_target", "workflow_run", "workflow_call"];

const steps = (job: unknown): Node[] => {
  const list = record(job)["steps"];
  return Array.isArray(list) ? list.map(record) : [];
};

// `on:` may be one event name, a list of names, or a mapping keyed by event.
const eventNames = (on: unknown): unknown[] =>
  Array.isArray(on) ? on : isRecord(on) ? Object.keys(on) : [on];

const grantsWrite = (permissions: unknown): boolean =>
  permissions === "write-all" ||
  (isRecord(permissions) && Object.values(permissions).includes("write"));

const credentialFailures = (root: Node, jobs: Node, path: string): string[] => {
  const failures: string[] = [];
  const jobBodies = Object.values(jobs).map(record);
  if ([root, ...jobBodies].some((node) => grantsWrite(node["permissions"]))) {
    failures.push(`${path} must not request write permissions`);
  }
  const runners = jobBodies.flatMap((job) => documentStrings(job["runs-on"]));
  if (runners.some(({ text }) => /self-hosted|codebuild/i.test(text))) {
    failures.push(`${path} must not name a self-hosted runner`);
  }
  const events = eventNames(root["on"]);
  for (const event of PRIVILEGED_EVENTS.filter((name) => events.includes(name))) {
    failures.push(`${path} must not trigger on ${event}`);
  }
  return failures;
};

// The commands of steps that always run: a conditional step may be skipped.
const unconditionalRuns = (job: unknown): unknown[] =>
  steps(job).flatMap((step) =>
    Object.hasOwn(step, "run") && !Object.hasOwn(step, "if") ? [step["run"]] : [],
  );

const suiteFailures = (root: Node, speculos: Node, path: string): string[] => {
  const failures: string[] = [];
  if (!unconditionalRuns(speculos).includes(REQUIRE_HASHES)) {
    failures.push(`${path} must fail while the Ledger app hashes are unrecorded`);
  }
  if (!unconditionalRuns(speculos).includes(SUITE)) {
    failures.push(`${path} must run the suite with BRAMBLE_SPECULOS_REQUIRED=1`);
  }
  // Exactly one decoded key or value names the suite or its switch: the
  // suite's own command, as a speculos step's run.
  const mentions = documentStrings(root).filter(({ text }) =>
    /test:e2e:ledger|BRAMBLE_SPECULOS_REQUIRED/.test(text),
  );
  const only = mentions.length === 1 ? mentions[0] : undefined;
  const [jobsKey, job, stepsKey, , runKey] = only?.path ?? [];
  if (
    only?.key !== false ||
    only.text !== SUITE ||
    !same([jobsKey, job, stepsKey, runKey], ["jobs", "speculos", "steps", "run"])
  ) {
    failures.push(`${path} must run the suite only as \`run: ${SUITE}\``);
  }
  const uploads = Object.values(record(root["jobs"]))
    .flatMap(steps)
    .filter((step) => String(step["uses"]).startsWith("actions/upload-artifact@"));
  if (uploads.length !== 1) {
    failures.push(`${path} must upload one artifact, the failure traces`);
  }
  if (!steps(speculos).some((step) => same(step, UPLOAD_STEP))) {
    failures.push(`${path} must upload only Playwright output, only on failure, kept 7 days`);
  }
  return failures;
};

const recordFailures = (recordJob: Node, path: string): string[] => {
  const failures: string[] = [];
  if (recordJob["if"] !== RECORD_IF) {
    failures.push(`${path} must run record mode only on a dispatch that asks for it`);
  }
  // `shell: bash` runs with pipefail, so a failed report is not hidden by tee.
  const reports = steps(recordJob).filter((step) => step["run"] === RECORD_HASHES);
  const report = reports.length === 1 ? reports[0] : undefined;
  if (report?.["shell"] !== "bash" || Object.hasOwn(report, "if")) {
    failures.push(`${path} must report the recorded hashes and fail when one is missing`);
  }
  if (documentStrings(recordJob).some(({ text }) => text.includes("test:e2e"))) {
    failures.push(`${path} record mode must not run tests`);
  }
  return failures;
};

/**
 * Violations of the Ledger E2E workflow's named controls in the decoded
 * document `root`, each prefixed with `path`. `root` must come from a strict
 * read (`workflow-strict-document.ts`); a missing or misshapen part reads as
 * absent, so the control it carries fails. Pure.
 */
export const ledgerE2eControlFailures = (root: Node, path: string): string[] => {
  const jobs = record(root["jobs"]);
  const speculos = record(jobs["speculos"]);
  const failures = credentialFailures(root, jobs, path);
  if (speculos["if"] !== SPECULOS_IF) {
    failures.push(`${path} must skip the test job in record mode`);
  }
  failures.push(...suiteFailures(root, speculos, path));
  if (documentStrings(jobs).some(({ key, text }) => key && text === "continue-on-error")) {
    failures.push(`${path} must not tolerate a failed step`);
  }
  failures.push(...recordFailures(record(jobs["record-hashes"]), path));
  return failures;
};
