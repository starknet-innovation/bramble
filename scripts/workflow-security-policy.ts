/**
 * Enforces the repository's privileged GitHub Actions trust boundaries.
 *
 * These checks intentionally inspect workflow text rather than executing YAML:
 * the protected properties are exact, reviewable policy statements (runner
 * class, token scope, immutable refs, and event guards), not general YAML shape.
 */
import { readFile } from "node:fs/promises";

const RUST_TOOLCHAIN_ACTION = "dtolnay/rust-toolchain@4be7066ada62dd38de10e7b70166bc74ed198c30";
const GITHUB_EXPRESSION = "$" + "{{";
const SHELL_EXPANSION = "$" + "{";
const RUST_TOOLCHAIN_BLOCK = `uses: ${RUST_TOOLCHAIN_ACTION} # stable
        with:
          toolchain: 1.96.1`;

const WORKFLOW_PATHS = {
  ci: ".github/workflows/ci.yml",
  nightly: ".github/workflows/nightly.yml",
  releaseBuild: ".github/workflows/release-build.yml",
  releaseIntegration: ".github/workflows/release-integration.yml",
  release: ".github/workflows/release.yml",
  roadmap: ".github/workflows/roadmap-project-sync.yml",
} as const;

type WorkflowName = keyof typeof WORKFLOW_PATHS;
type WorkflowSources = Readonly<Record<WorkflowName, string>>;

const jobBody = (workflow: string, job: string): string => {
  const bounded = `${workflow}\n  __workflow_policy_end__:\n`;
  const escaped = job.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    bounded.match(new RegExp(`^  ${escaped}:\\n[\\s\\S]*?(?=^  [a-zA-Z0-9_-]+:\\n)`, "m"))?.[0] ??
    ""
  );
};

const requireText = (
  failures: string[],
  source: string,
  expected: string,
  failure: string,
): void => {
  if (!source.includes(expected)) {
    failures.push(failure);
  }
};

const forbidText = (
  failures: string[],
  source: string,
  forbidden: string,
  failure: string,
): void => {
  if (source.includes(forbidden)) {
    failures.push(failure);
  }
};

const rustToolchainFailures = (sources: WorkflowSources): string[] => {
  const failures: string[] = [];
  for (const name of ["ci", "nightly", "releaseBuild", "releaseIntegration"] as const) {
    requireText(
      failures,
      sources[name],
      RUST_TOOLCHAIN_BLOCK,
      `${WORKFLOW_PATHS[name]} must pin Rust toolchain 1.96.1`,
    );
    const occurrences = sources[name].split(RUST_TOOLCHAIN_ACTION).length - 1;
    if (occurrences !== 1) {
      failures.push(`${WORKFLOW_PATHS[name]} must use the pinned Rust action exactly once`);
    }
  }
  return failures;
};

const ciFailures = (source: string): string[] => {
  const failures: string[] = [];
  const validation = jobBody(source, "release-validation");
  requireText(
    failures,
    validation,
    "github.event.pull_request.head.repo.full_name == github.repository",
    "release-validation must reject fork-controlled branches before using the self-hosted runner",
  );
  return failures;
};

const releaseBuildFailures = (source: string): string[] => {
  const failures: string[] = [];
  const build = jobBody(source, "build-release");
  const publish = jobBody(source, "publish-release");
  requireText(
    failures,
    build,
    "permissions:\n      contents: read",
    "self-hosted release builds must have read-only repository permission",
  );
  forbidText(
    failures,
    build,
    "contents: write",
    "self-hosted release builds must not receive repository write permission",
  );
  requireText(
    failures,
    publish,
    "runs-on: ubuntu-latest",
    "GitHub Release publication must use a hosted runner",
  );
  requireText(
    failures,
    publish,
    "permissions:\n      contents: write",
    "the hosted release publisher must declare its narrow write permission",
  );
  forbidText(
    failures,
    publish,
    "actions/checkout@",
    "the hosted release publisher must not check out or execute wallet source",
  );
  requireText(
    failures,
    publish,
    "actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131",
    "the hosted release publisher must consume the pinned build artifact",
  );
  return failures;
};

const releaseFailures = (source: string): string[] => {
  const failures: string[] = [];
  const prepare = jobBody(source, "prepare");
  const publish = jobBody(source, "publish-chrome-web-store");
  requireText(
    failures,
    prepare,
    `ref: ${GITHUB_EXPRESSION} github.event_name == 'workflow_dispatch' && 'main' || github.ref }}`,
    "manual release preparation must derive inputs from trusted main",
  );
  requireText(
    failures,
    prepare,
    '[ "$TRIGGER_REF" != "refs/heads/main" ]',
    "manual release dispatches must reject workflow revisions outside main",
  );
  requireText(
    failures,
    prepare,
    `git ls-remote --exit-code --tags origin "refs/tags/${SHELL_EXPANSION}tag}"`,
    "manual store publication must require an existing immutable release tag",
  );
  requireText(
    failures,
    publish,
    "github.ref == 'refs/heads/main'",
    "Chrome Web Store publication must accept dispatches from main only",
  );
  requireText(
    failures,
    publish,
    "runs-on: ubuntu-latest",
    "Chrome Web Store publication must use a hosted runner",
  );
  requireText(
    failures,
    publish,
    "ref: main",
    "Chrome Web Store publication must execute the reviewed client from main",
  );
  requireText(
    failures,
    publish,
    "sha256sum -c ./*.zip.sha256",
    "Chrome Web Store publication must verify its downloaded artifact",
  );
  return failures;
};

const nightlyFailures = (source: string): string[] => {
  const failures: string[] = [];
  const resolve = jobBody(source, "resolve");
  const nightly = jobBody(source, "nightly");
  const report = jobBody(source, "report");
  requireText(
    failures,
    resolve,
    '[ "$EVENT_NAME" = "workflow_dispatch" ] && [ "$TRIGGER_REF" != "refs/heads/main" ]',
    "nightly manual dispatches must reject workflow revisions outside main",
  );
  requireText(
    failures,
    resolve,
    '[[ ! "$candidate" =~ ^release/v[0-9]+\\.[0-9]+$ ]]',
    "nightly must constrain configured refs to canonical release branches",
  );
  requireText(
    failures,
    resolve,
    'grep -Fxq -- "$candidate"',
    "nightly must require the exact configured branch to exist in the base repository",
  );
  requireText(
    failures,
    nightly,
    "permissions:\n      contents: read",
    "self-hosted nightly execution must declare read-only repository permission",
  );
  forbidText(
    failures,
    nightly,
    "issues: write",
    "self-hosted nightly execution must not receive issue write permission",
  );
  requireText(
    failures,
    report,
    "runs-on: ubuntu-latest",
    "nightly issue reporting must use a hosted runner",
  );
  requireText(
    failures,
    report,
    "issues: write",
    "the hosted nightly reporter must declare its narrow issue permission",
  );
  forbidText(
    failures,
    report,
    "actions/checkout@",
    "the hosted nightly reporter must not check out or execute release-branch source",
  );
  return failures;
};

const roadmapFailures = (source: string): string[] => {
  const failures: string[] = [];
  const verify = jobBody(source, "verify");
  requireText(
    failures,
    source,
    "pull_request_target:",
    "roadmap token verification must execute the trusted base workflow",
  );
  forbidText(
    failures,
    source,
    "\n  pull_request:\n",
    "roadmap token verification must not execute a pull-request workflow revision",
  );
  forbidText(
    failures,
    verify,
    "actions/checkout@",
    "roadmap token verification must never check out pull-request code",
  );
  return failures;
};

/**
 * Returns every privileged-workflow policy violation found in supplied sources.
 * It performs no I/O so tests can mutate one control at a time.
 */
export const workflowSecurityPolicyFailures = (sources: WorkflowSources): string[] => [
  ...rustToolchainFailures(sources),
  ...ciFailures(sources.ci),
  ...releaseBuildFailures(sources.releaseBuild),
  ...releaseFailures(sources.release),
  ...nightlyFailures(sources.nightly),
  ...roadmapFailures(sources.roadmap),
];

/** Loads repository workflows and returns all privileged-workflow policy violations. */
export const workflowSecurityFailures = async (): Promise<string[]> => {
  const entries = await Promise.all(
    Object.entries(WORKFLOW_PATHS).map(async ([name, path]) => [
      name,
      await readFile(path, "utf8"),
    ]),
  );
  return workflowSecurityPolicyFailures(
    Object.fromEntries(entries) as Record<WorkflowName, string>,
  );
};
