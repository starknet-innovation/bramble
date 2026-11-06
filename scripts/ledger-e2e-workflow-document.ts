/**
 * Structural half of the Ledger E2E workflow policy: what GitHub will actually
 * execute, read from the parsed document rather than its spelling. YAML admits
 * escapes (`"uses"`), comments and inert strings, so a control matched
 * only as text can be kept in place while it stops applying. Here the event
 * map, jobs, step order, commands, conditions, shells and action references
 * are compared with the reviewed shape, and every decoded string is searched
 * for credential expressions. An unparseable workflow fails closed.
 */
import {
  NIGHTLY_TARGET_CHECKOUT_USES,
  NIGHTLY_TARGET_CHECKOUT_WITH,
  NIGHTLY_TARGET_SCRIPT,
  NIGHTLY_TARGET_STEP,
} from "./ledger-e2e-nightly-target";
import { isPinnedActionReference } from "./workflow-inventory";

const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g;
const GITHUB_TOKEN = /\bgithub\s*(?:\.\s*token\b|\[\s*['"]token['"]\s*\])/i;
const ROOT_KEYS = ["concurrency", "jobs", "name", "on", "permissions", "run-name"];
const JOB_KEYS = ["if", "name", "runs-on", "steps", "timeout-minutes"];
const STEP_KEYS = ["env", "id", "if", "name", "run", "shell", "timeout-minutes", "uses", "with"];
const EVENTS = ["pull_request", "push", "schedule", "workflow_dispatch"];
const BRANCHES = ["main", "release/**"];
const REQUIRED_PATHS = [
  ".github/workflows/ledger-e2e.yml",
  "packages/platform/ledger-*/**",
  "playwright.ledger.config.ts",
  "scripts/*ledger*",
  "tests/e2e/ledger/**",
];

const CHECKOUT = { action: "actions/checkout", if: null, with: { "persist-credentials": false } };
const NIGHTLY_CHECKOUT = { ...CHECKOUT, with: NIGHTLY_TARGET_CHECKOUT_WITH };
const BUN = { action: "oven-sh/setup-bun", if: null, with: { "bun-version": "1.3.3" } };
const NODE = { action: "actions/setup-node", if: null, with: { "node-version": 24 } };
const TRACES = {
  action: "actions/upload-artifact",
  if: "failure()",
  with: {
    name: "ledger-e2e-traces",
    path: "test-results/",
    "retention-days": 7,
    "if-no-files-found": "ignore",
  },
};

// A record run runs no test, so it must say so wherever a run is listed.
const RECORD_NAME = "Record Ledger app hashes (no tests run)";
const RUN_NAME = `\${{ inputs.record_hashes && '${RECORD_NAME}' || '' }}`;

type JobShape = {
  readonly actions: readonly unknown[];
  readonly if: string;
  readonly name: string;
  readonly runs: readonly string[];
};

/** Each job's reviewed `if:`, exact actions (with inputs) and exact commands, in order. */
const JOBS: Readonly<Record<string, JobShape>> = {
  "record-hashes": {
    name: RECORD_NAME,
    actions: [CHECKOUT, BUN],
    if: "github.event_name == 'workflow_dispatch' && inputs.record_hashes",
    runs: [
      "bun install --frozen-lockfile",
      "bun run vendor:ledger-app",
      'bun run scripts/ledger-app-hashes.ts record | tee -a "$GITHUB_STEP_SUMMARY"',
    ],
  },
  speculos: {
    name: "Speculos Ledger E2E",
    actions: [NIGHTLY_CHECKOUT, BUN, NODE, TRACES],
    if: "${{ !inputs.record_hashes }}",
    runs: [
      NIGHTLY_TARGET_SCRIPT,
      "bun run scripts/ledger-app-hashes.ts require nanosp flex",
      "bun install --frozen-lockfile",
      "bun run vendor:argent",
      "bun run vendor:privacy",
      "bun run build",
      "bun run test:e2e:install --with-deps",
      "bun run vendor:ledger-app nanosp flex",
      "BRAMBLE_SPECULOS_REQUIRED=1 bun run test:e2e:ledger",
      "bun run scripts/ledger-e2e-results.ts nanosp flex",
    ],
  },
};

type Node = Record<string, unknown>;

const isRecord = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown): Node => (isRecord(value) ? value : {});

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

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

const extraKeys = (node: Node, allowed: readonly string[]): string[] =>
  Object.keys(node).filter((key) => !allowed.includes(key));

const strings = (node: unknown, found: string[] = []): string[] => {
  if (typeof node === "string") {
    found.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) strings(item, found);
  } else if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      found.push(key);
      strings(value, found);
    }
  }
  return found;
};

const credentialFailures = (document: unknown, path: string): string[] => {
  const failures = new Set<string>();
  for (const text of strings(document)) {
    for (const match of text.matchAll(EXPRESSION)) {
      const body = match[1] ?? "";
      if (/\bsecrets\b/i.test(body)) failures.add(`${path} must not use any repository secret`);
      if (GITHUB_TOKEN.test(body)) failures.add(`${path} must not hand the GitHub token to a step`);
    }
  }
  return [...failures];
};

const eventFailures = (events: Node, path: string): string[] => {
  const failures: string[] = [];
  if (!same(Object.keys(events).sort(), EVENTS)) {
    failures.push(`${path} must trigger on exactly ${EVENTS.join(", ")}`);
  }
  const pull = record(events["pull_request"]);
  const push = record(events["push"]);
  const paths = Array.isArray(pull["paths"]) ? pull["paths"] : [];
  if (
    !same(pull["branches"], BRANCHES) ||
    !same(push["branches"], BRANCHES) ||
    !same(paths, push["paths"]) ||
    REQUIRED_PATHS.some((required) => !paths.includes(required)) ||
    // A later negative pattern would exclude what the list appears to cover.
    paths.some((entry) => typeof entry !== "string" || entry.startsWith("!")) ||
    extraKeys(pull, ["branches", "paths"]).length + extraKeys(push, ["branches", "paths"]).length >
      0
  ) {
    failures.push(`${path} must run on Ledger changes into main and release branches`);
  }
  const schedule = events["schedule"];
  if (!Array.isArray(schedule) || schedule.length !== 1) {
    failures.push(`${path} must keep its nightly schedule`);
  }
  const inputs = record(record(events["workflow_dispatch"])["inputs"]);
  const recordHashes = record(inputs["record_hashes"]);
  if (
    !same(Object.keys(inputs), ["record_hashes"]) ||
    recordHashes["type"] !== "boolean" ||
    recordHashes["default"] !== false
  ) {
    failures.push(`${path} must offer record mode only as a boolean input, off by default`);
  }
  return failures;
};

// The resolve step first, then the checkout of its output: in any other order
// a scheduled run would test the default branch and still look correct.
const nightlyTargetFailures = (steps: readonly unknown[], path: string): string[] => {
  const failures: string[] = [];
  if (!same(steps[0], NIGHTLY_TARGET_STEP)) {
    failures.push(`${path} must resolve the nightly release commit first, exactly as reviewed`);
  }
  const checkout = record(steps[1]);
  if (
    checkout["uses"] !== NIGHTLY_TARGET_CHECKOUT_USES ||
    !same(extraKeys(checkout, ["uses", "with"]), []) ||
    !same(checkout["with"], NIGHTLY_TARGET_CHECKOUT_WITH)
  ) {
    failures.push(`${path} must check out the resolved nightly commit second`);
  }
  return failures;
};

const stepFailures = (job: string, steps: readonly unknown[], path: string): string[] => {
  const failures: string[] = [];
  for (const step of steps.map(record)) {
    for (const key of extraKeys(step, STEP_KEYS)) {
      failures.push(`${path} job ${job} must not declare step ${key}`);
    }
    const uses = typeof step["uses"] === "string" ? step["uses"] : null;
    if (uses !== null && !isPinnedActionReference(uses)) {
      failures.push(`${path} job ${job} must pin ${uses} to a commit SHA`);
    }
    if (
      uses?.startsWith("actions/checkout@") &&
      record(step["with"])["persist-credentials"] !== false
    ) {
      failures.push(`${path} must not leave a checkout token in .git/config`);
    }
    if (uses?.startsWith("oven-sh/setup-bun@") && record(step["with"])["bun-version"] !== "1.3.3") {
      failures.push(`${path} must use the repository's pinned Bun 1.3.3`);
    }
    // A conditional step can be skipped while its text stays in place; only
    // the failure-trace upload may be conditional.
    const traces = uses?.startsWith("actions/upload-artifact@") && step["if"] === "failure()";
    if (Object.hasOwn(step, "if") && !traces) {
      failures.push(`${path} job ${job} must not make a step conditional`);
    }
    // Only the nightly resolve step may set an id or environment.
    if (
      (Object.hasOwn(step, "env") || Object.hasOwn(step, "id")) &&
      !same(step, NIGHTLY_TARGET_STEP)
    ) {
      failures.push(`${path} job ${job} must not give a step an id or environment`);
    }
    if (Object.hasOwn(step, "shell") && step["shell"] !== "bash") {
      failures.push(`${path} job ${job} must run steps in the default bash shell`);
    }
  }
  const runs = steps
    .map(record)
    .flatMap((step) => (Object.hasOwn(step, "run") ? [step["run"]] : []));
  if (job === "speculos") failures.push(...nightlyTargetFailures(steps, path));
  if (!same(runs, JOBS[job]?.runs)) {
    failures.push(`${path} job ${job} must run exactly the reviewed commands, in order`);
  }
  const actions = steps.map(record).flatMap((step) =>
    typeof step["uses"] === "string"
      ? [
          {
            action: step["uses"].split("@")[0],
            if: step["if"] ?? null,
            with: step["with"] ?? null,
          },
        ]
      : [],
  );
  if (!same(actions, JOBS[job]?.actions)) {
    failures.push(`${path} job ${job} must use exactly the reviewed actions and inputs, in order`);
  }
  return failures;
};

const jobFailures = (jobs: Node, path: string): string[] => {
  const failures: string[] = [];
  if (!same(Object.keys(jobs).sort(), Object.keys(JOBS).sort())) {
    failures.push(`${path} must define exactly the jobs ${Object.keys(JOBS).sort().join(", ")}`);
  }
  for (const [name, value] of Object.entries(jobs)) {
    const job = record(value);
    if (job["runs-on"] !== "ubuntu-latest") {
      failures.push(`${path} job ${name} must run on a GitHub-hosted ubuntu-latest runner`);
    }
    for (const key of extraKeys(job, JOB_KEYS)) {
      failures.push(`${path} job ${name} must not declare ${key}`);
    }
    if (typeof job["timeout-minutes"] !== "number") {
      failures.push(`${path} job ${name} must set timeout-minutes`);
    }
    if (job["name"] !== JOBS[name]?.name) {
      failures.push(`${path} job ${name} must keep its reviewed name`);
    }
    if (job["if"] !== JOBS[name]?.if) {
      failures.push(`${path} job ${name} must keep its reviewed run condition`);
    }
    const steps = Array.isArray(job["steps"]) ? job["steps"] : [];
    failures.push(...stepFailures(name, steps, path));
  }
  return failures;
};

/**
 * Structural violations of the Ledger E2E workflow's reviewed shape. Pure: it
 * parses only the text it is given.
 */
export const ledgerE2eDocumentFailures = (source: string, path: string): string[] => {
  let document: unknown;
  try {
    document = Bun.YAML.parse(source);
  } catch {
    return [`${path} must be parseable YAML so its controls can be checked`];
  }
  // YAML 1.1 reads the bare key `on` as the boolean true; GitHub reads `on`.
  const { true: events, ...rest } = record(document);
  const root: Node = events === undefined ? rest : { on: events, ...rest };
  const failures = extraKeys(root, ROOT_KEYS).map(
    (key) => `${path} must not declare workflow-level ${key}`,
  );
  if (root["run-name"] !== RUN_NAME) {
    failures.push(`${path} must name a record run as one that runs no tests`);
  }
  const permissions = record(root["permissions"]);
  if (!same(permissions, { contents: "read" })) {
    failures.push(`${path} must grant only contents: read`);
  }
  const concurrency = record(root["concurrency"]);
  const group = typeof concurrency["group"] === "string" ? concurrency["group"] : "";
  if (
    concurrency["cancel-in-progress"] !== true ||
    !group.startsWith("ledger-e2e-") ||
    !group.includes("inputs.record_hashes")
  ) {
    failures.push(`${path} must cancel superseded runs per mode with a concurrency group`);
  }
  failures.push(
    ...eventFailures(record(root["on"]), path),
    ...jobFailures(record(root["jobs"]), path),
    ...credentialFailures(document, path),
  );
  return failures;
};
