/**
 * The Mainnet E2E workflow's reviewed top level and job settings, compared on
 * the parsed document.
 *
 * The workflow may declare only its name, triggers, permissions, concurrency
 * and jobs, so no workflow-level `env` or `defaults` (a default shell would
 * change every script) can be added. Triggers are exactly `schedule` and
 * `workflow_dispatch`. Each job's keys other than `steps` are compared whole:
 * runner, permissions, timeout, environment, needs, condition, outputs and
 * job `env`. Steps are compared in `mainnet-e2e-workflow-steps.ts` and
 * `mainnet-e2e-workflow-execute.ts`.
 */
import { MAINNET_E2E_WORKFLOW_NAME } from "./mainnet-e2e-guard";
import { EXECUTE_ORDER, EXECUTE_STEPS } from "./mainnet-e2e-workflow-execute";
import { BRANCH_INPUT_DESCRIPTION } from "./mainnet-e2e-workflow-scripts";
import {
  matches,
  record,
  type Shape,
  stepsFailures,
  withoutDefaults,
} from "./mainnet-e2e-workflow-shape";
import { OTHER_JOB_STEPS } from "./mainnet-e2e-workflow-steps";

const PATH = ".github/workflows/mainnet-e2e.yml";
const expression = (body: string): string => `\${{ ${body} }}`;
const step = (id: string, output: string): string => expression(`steps.${id}.outputs.${output}`);
const outputs = (id: string, names: readonly string[]): Record<string, string> =>
  Object.fromEntries(names.map((name) => [name, step(id, name)]));

/** The execute job's reviewed `if:`, compared as a decoded string. */
export const EXECUTE_CONDITION =
  "needs.gate.outputs.run == 'true' && needs.preflight.result == 'success' && needs.build.result == 'success' && github.repository == 'starknet-innovation/bramble' && github.event.repository.fork != true && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')";

const HOSTED = "ubuntu-latest";
const CODEBUILD = [
  `codebuild-gha-runner-mc-wallet-${expression("github.run_id")}-${expression("github.run_attempt")}`,
];
const READ = { contents: "read" };
const GATED = "needs.gate.outputs.run == 'true'";
const BALANCE = { name: "mainnet-e2e-balance" };

/** Each job's reviewed keys other than `steps`, with their exact decoded values. */
const JOBS: Readonly<Record<string, { readonly [key: string]: Shape }>> = {
  resolve: { "runs-on": HOSTED, outputs: outputs("pick", ["branch", "revision"]) },
  gate: {
    needs: "resolve",
    if: "needs.resolve.outputs.branch != ''",
    "runs-on": HOSTED,
    outputs: outputs("decide", ["run"]),
  },
  preflight: {
    needs: ["resolve", "gate"],
    if: GATED,
    environment: BALANCE,
    permissions: READ,
    "runs-on": HOSTED,
    outputs: outputs("balance", ["strk_before_raw", "usdc_before_raw", "rpc_sha256"]),
  },
  build: {
    needs: ["resolve", "gate"],
    if: GATED,
    permissions: READ,
    "timeout-minutes": 60,
    "runs-on": CODEBUILD,
    outputs: { bundle_sha256: step("pack", "sha256") },
  },
  execute: {
    needs: ["resolve", "gate", "preflight", "build"],
    if: EXECUTE_CONDITION,
    environment: { name: "mainnet-e2e" },
    permissions: READ,
    "timeout-minutes": 120,
    "runs-on": CODEBUILD,
    outputs: { playwright: step("playwright", "result"), gasless: step("gasless", "result") },
    env: { PLAYWRIGHT_BROWSERS_PATH: `${expression("github.workspace")}/.playwright-browsers` },
  },
  post: {
    needs: ["resolve", "gate", "preflight", "build", "execute"],
    if: "always() && needs.preflight.result == 'success'",
    environment: BALANCE,
    permissions: READ,
    "runs-on": HOSTED,
    outputs: outputs("balance", [
      "verdict",
      "strk_before",
      "strk_after",
      "strk_delta",
      "usdc_before",
      "usdc_after",
      "usdc_delta",
    ]),
  },
  report: {
    needs: ["resolve", "gate", "preflight", "build", "execute", "post"],
    if: "always() && needs.gate.outputs.run == 'true' && (needs.preflight.result == 'failure' || needs.build.result == 'failure' || needs.execute.result == 'failure' || needs.post.result == 'failure')",
    "runs-on": HOSTED,
    permissions: { contents: "read", issues: "write" },
  },
};

/** Failures that name the control a job setting carries, where one is more specific. */
const SETTING_FAILURES: Readonly<Record<string, string>> = {
  "execute.permissions":
    "self-hosted mainnet execution must declare read-only repository permission",
  "execute.runs-on": "mainnet execution must use the existing CodeBuild runner",
  "execute.timeout-minutes":
    "mainnet execution must time out so a stuck run releases the nonce lock",
  "preflight.outputs": "the preflight must publish the hash of the RPC it validated",
  "preflight.runs-on":
    "the preflight balance check must run on a hosted runner, apart from the tests",
  "post.runs-on": "the post balance check must run on a hosted runner, apart from the tests",
  "report.runs-on": "mainnet issue reporting must use a hosted runner",
  "report.permissions": "the hosted mainnet reporter must declare its narrow issue permission",
};

/** Reported when the reporter runs anything but its one reviewed action. */
export const REPORT_ORDER =
  "the hosted mainnet reporter must run only its reviewed step: no checkout and no release-branch source";

const ROOT_KEYS = ["concurrency", "jobs", "name", "on", "permissions"];
const TRIGGERS = ["schedule", "workflow_dispatch"];

const DISPATCH: Shape = {
  inputs: { branch: { description: BRANCH_INPUT_DESCRIPTION, type: "string", default: "" } },
};

/**
 * Violations of the workflow's top level: its keys, name, triggers,
 * permissions and concurrency. A trigger written as anything but a mapping
 * fails as a missing schedule and dispatch.
 */
export const rootFailures = (root: Record<string, unknown>): string[] => {
  const failures = Object.keys(root)
    .filter((key) => !ROOT_KEYS.includes(key))
    .map((key) => `${PATH} must not declare workflow-level ${key}`);
  if (root["name"] !== MAINNET_E2E_WORKFLOW_NAME) {
    failures.push(`${PATH} must keep the name ${MAINNET_E2E_WORKFLOW_NAME}`);
  }
  const events = record(root["on"]);
  for (const trigger of Object.keys(events).filter((key) => !TRIGGERS.includes(key))) {
    failures.push(`${PATH} must not trigger on ${trigger}:`);
  }
  if (!matches([{ cron: "0 6 * * *" }], events["schedule"])) {
    failures.push(`${PATH} must schedule at 06:00 UTC, offset from nightly`);
  }
  if (!matches(DISPATCH, events["workflow_dispatch"])) {
    failures.push(`${PATH} must allow manual dispatch with only the branch input`);
  }
  if (!matches(READ, root["permissions"])) {
    failures.push(`${PATH} must grant only contents: read at workflow level`);
  }
  if (!matches({ group: "mainnet-e2e", "cancel-in-progress": false }, root["concurrency"])) {
    failures.push(`${PATH} must queue on mainnet-e2e and must not cancel an in-flight run`);
  }
  return failures;
};

const settingFailures = (name: string, job: Record<string, unknown>): string[] => {
  const reviewed = JOBS[name] ?? {};
  const { steps: _steps, ...settings } = withoutDefaults(job);
  const failures = Object.keys(settings)
    .filter((key) => !Object.hasOwn(reviewed, key))
    .map((key) => `the ${name} job must not declare ${key}`);
  for (const [key, shape] of Object.entries(reviewed)) {
    if (!matches(shape, settings[key])) {
      failures.push(
        SETTING_FAILURES[`${name}.${key}`] ?? `the ${name} job must keep its reviewed ${key}`,
      );
    }
  }
  return failures;
};

/**
 * Violations of the job map: exactly the reviewed jobs, each with exactly its
 * reviewed settings and steps. A job that is not a mapping, or whose `steps`
 * is not a list, fails every check that needs it.
 */
export const jobFailures = (jobs: Record<string, unknown>): string[] => {
  const names = Object.keys(JOBS);
  const failures = matches([...names].sort(), Object.keys(jobs).sort())
    ? []
    : [`${PATH} must define exactly the jobs ${[...names].sort().join(", ")}`];
  for (const name of names) {
    const job = record(jobs[name]);
    failures.push(...settingFailures(name, job));
    failures.push(
      ...(name === "execute"
        ? stepsFailures(job["steps"], EXECUTE_STEPS, EXECUTE_ORDER)
        : stepsFailures(
            job["steps"],
            OTHER_JOB_STEPS[name] ?? [],
            name === "report"
              ? REPORT_ORDER
              : `the ${name} job must run exactly the reviewed steps, in order`,
          )),
    );
  }
  return failures;
};
