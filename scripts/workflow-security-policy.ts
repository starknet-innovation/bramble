/**
 * Enforces the repository's privileged GitHub Actions trust boundaries.
 *
 * These checks intentionally inspect workflow text rather than executing YAML:
 * the protected properties are exact, reviewable policy statements (runner
 * class, token scope, immutable refs, and event guards), not general YAML shape.
 *
 * The set of workflows is read from the directory (./workflow-inventory), never
 * from a table here. Every workflow found gets the baseline below; the named
 * policies add per-workflow rules on top, and the vendoring rules select
 * themselves from workflow content. A workflow added tomorrow is therefore
 * checked without anyone remembering to list it — which is the whole point: the
 * previous hand-maintained list had already fallen three workflows behind.
 */
import { MOBILE_WORKFLOW, mobileWorkflowFailures } from "./mobile-workflow-policy";
import { dynamicExecutionFailures } from "./vendor-pin-policy";
import { websiteDeployFailures } from "./website-deploy-policy";
import { readWorkflowSources, type WorkflowSources } from "./workflow-inventory";
import { forbidText, jobBody, requireText, workflowPath } from "./workflow-policy-text";

const NODE_SETUP_ACTION = "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1";
const GITHUB_EXPRESSION = "$" + "{{";
const SHELL_EXPANSION = "$" + "{";
const NODE_SETUP_BLOCK = `uses: ${NODE_SETUP_ACTION} # v7.1.0
        with:
          node-version: 24`;

// Upstream verification is all-or-nothing: a workflow that builds one pinned
// source against a stale or unverified other one is not running the reviewed artifact set. The
// rule selects itself from content, so it reaches any future workflow that
// vendors anything.
const VENDOR_STEPS = [
  { command: "bun run vendor:argent", failure: "must verify the pinned Argent account contracts" },
  { command: "bun run vendor:privacy", failure: "must vendor the pinned privacy SDK" },
] as const;

// Applies to any workflow that vendors a pinned source, selected by content.
// The privacy SDK build depends on the exact Node runtime, so the pin travels
// with the vendoring step rather than with a list of workflow names.
const vendoringFailures = (name: string, source: string): string[] => {
  const failures: string[] = [];
  if (!VENDOR_STEPS.some((step) => source.includes(step.command))) {
    return failures;
  }
  const path = workflowPath(name);
  for (const step of VENDOR_STEPS) {
    requireText(failures, source, step.command, `${path} ${step.failure}`);
  }
  requireText(
    failures,
    source,
    NODE_SETUP_BLOCK,
    `${path} must pin Node.js 24 for privacy SDK vendoring`,
  );
  // A workflow that vendors pinned sources is on the path that produces the
  // release artifact. Every executable it runs must come from a pin or a
  // lockfile: a package resolved by name at run time executes with the
  // workspace's write access before any digest, manifest, or package check
  // exists to notice what it changed.
  failures.push(...dynamicExecutionFailures(source, path));
  return failures;
};

// What every workflow owes regardless of what it does, plus the privileged
// capabilities a workflow may not take without a reviewed policy of its own.
// A new workflow can still be added freely — it just cannot quietly claim the
// self-hosted runner or a base-repository-privileged trigger while doing so.
const baselineFailures = (name: string, source: string, reviewed: boolean): string[] => {
  const failures: string[] = [];
  const path = workflowPath(name);
  requireText(
    failures,
    source,
    "\npermissions:\n  contents: read\n",
    `${path} must declare a read-only default permissions block`,
  );
  forbidText(failures, source, "write-all", `${path} must not request every token permission`);
  forbidText(
    failures,
    source,
    "vendor:krusty",
    `${path} must consume the pinned published Krusty package instead of vendoring source`,
  );
  if (reviewed) {
    return failures;
  }
  const hosted = source
    .split("\n")
    .filter((line) => /^\s*runs-on:/.test(line))
    .every((line) => line.trim() === "runs-on: ubuntu-latest");
  if (!hosted) {
    failures.push(`${path} must use a hosted runner or declare a reviewed workflow policy`);
  }
  for (const trigger of ["pull_request_target:", "workflow_run:"]) {
    forbidText(
      failures,
      source,
      trigger,
      `${path} must declare a reviewed workflow policy before using ${trigger}`,
    );
  }
  return failures;
};

const scopedServiceSecretFailures = (name: string, source: string): string[] => {
  if (!source.includes("CHROMATIC_PROJECT_TOKEN")) {
    return [];
  }
  const failures: string[] = [];
  const path = workflowPath(name);
  requireText(
    failures,
    source,
    `      - name: Publish to Chromatic
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        env:
          CHROMATIC_PROJECT_TOKEN: ${GITHUB_EXPRESSION} secrets.CHROMATIC_PROJECT_TOKEN }}
        run: |
          if [ -z "${SHELL_EXPANSION}CHROMATIC_PROJECT_TOKEN:-}" ]; then
            echo "::notice::Chromatic is not configured; GitHub Pages remains the published UI Lab."
            exit 0
          fi
          bun run --filter @bramble/ui-lab chromatic`,
    `${path} must expose the Chromatic token only to the main-push publish step`,
  );
  if (source.split("CHROMATIC_PROJECT_TOKEN").length - 1 !== 3) {
    failures.push(`${path} must reference the Chromatic token only in its scoped step environment`);
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
  forbidText(
    failures,
    build,
    "\n          ref:",
    "self-hosted release builds must not pass caller-controlled refs to checkout",
  );
  requireText(
    failures,
    build,
    `RELEASE_COMMIT: ${GITHUB_EXPRESSION} inputs.commit_sha }}`,
    "release builds must consume an immutable commit input",
  );
  requireText(
    failures,
    build,
    '[[ ! "$RELEASE_TAG" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+$ ]]',
    "release builds must constrain the release tag before resolving it",
  );
  requireText(
    failures,
    build,
    '[[ ! "$RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ ]]',
    "release builds must validate the immutable commit input",
  );
  requireText(
    failures,
    build,
    'git checkout --detach "$RELEASE_COMMIT"',
    "release builds must detach onto the verified immutable commit",
  );
  requireText(
    failures,
    build,
    "persist-credentials: false",
    "self-hosted release builds must not leave the checkout token in .git/config",
  );
  // Supply audit F2: the checksum step reads a file this job wrote, so it can
  // claim self-consistency only, never identity with another build.
  forbidText(
    failures,
    build,
    "byte-identical",
    "release builds must not claim a byte-identical artifact they never compare against",
  );
  // v0.10.6 shipped with only the Chromium zip (#684): AMO needs the Gecko
  // package built from the tagged commit, and validated before it is published.
  for (const step of ["bun run package:extension:firefox", "bun run check:firefox"]) {
    requireText(
      failures,
      build,
      `- run: ${step}`,
      "release builds must package and validate the Firefox target",
    );
  }
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
    "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333",
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
    '[[ ! "$candidate" =~ ^release/v[0-9]+\\.[0-9]+(\\.[0-9]+)?$ ]]',
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
    resolve,
    `revision="$(gh api "repos/$GITHUB_REPOSITORY/commits/$encoded_candidate" --jq '.sha')"`,
    "nightly must resolve the selected branch to an immutable commit",
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
  forbidText(
    failures,
    nightly,
    "\n          ref:",
    "self-hosted nightly execution must not pass configured refs to checkout",
  );
  requireText(
    failures,
    nightly,
    `REVISION: ${GITHUB_EXPRESSION} needs.resolve.outputs.revision }}`,
    "nightly execution must consume the resolved immutable commit",
  );
  requireText(
    failures,
    nightly,
    '[[ ! "$REVISION" =~ ^[0-9a-f]{40}$ ]]',
    "nightly execution must validate the resolved immutable commit",
  );
  requireText(
    failures,
    nightly,
    'git checkout --detach "$REVISION"',
    "nightly execution must detach onto the resolved immutable commit",
  );
  requireText(
    failures,
    nightly,
    "persist-credentials: false",
    "self-hosted nightly execution must not leave the checkout token in .git/config",
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

// Post-merge integration on the self-hosted runner. Its whole safety argument is
// that nothing outside the base repository can choose what it executes: the only
// trigger is a push to a release branch, no caller-supplied ref reaches checkout,
// and the job holds no write scope.
const releaseIntegrationFailures = (source: string): string[] => {
  const failures: string[] = [];
  const integration = jobBody(source, "integration");
  requireText(
    failures,
    source,
    'push:\n    branches: ["release/**"]',
    "release integration must run only on pushes to release branches",
  );
  forbidText(
    failures,
    source,
    "pull_request",
    "release integration must not execute pull-request revisions on the self-hosted runner",
  );
  forbidText(
    failures,
    integration,
    "contents: write",
    "self-hosted release integration must not receive repository write permission",
  );
  forbidText(
    failures,
    integration,
    "\n          ref:",
    "self-hosted release integration must not pass caller-controlled refs to checkout",
  );
  requireText(
    failures,
    integration,
    "persist-credentials: false",
    "self-hosted release integration must not leave the checkout token in .git/config",
  );
  return failures;
};

// Per-workflow policies, keyed by file name. Membership here means "this
// workflow's privileged behaviour has been reviewed and is pinned below", which
// is also what lets it hold a self-hosted runner or a privileged trigger.
const NAMED_POLICIES: Readonly<Record<string, (source: string) => string[]>> = {
  "ci.yml": ciFailures,
  [MOBILE_WORKFLOW]: mobileWorkflowFailures,
  "nightly.yml": nightlyFailures,
  "release-build.yml": releaseBuildFailures,
  "release-integration.yml": releaseIntegrationFailures,
  "release.yml": releaseFailures,
};

/**
 * Returns every privileged-workflow policy violation found in supplied sources,
 * which are keyed by workflow file name. It performs no I/O so tests can mutate
 * one control at a time. A reviewed workflow that is absent from the supplied
 * inventory is itself a failure: its rules would otherwise vanish with it.
 */
export const workflowSecurityPolicyFailures = (sources: WorkflowSources): string[] => {
  const failures: string[] = [];
  for (const name of Object.keys(NAMED_POLICIES)) {
    if (!Object.hasOwn(sources, name)) {
      failures.push(`${workflowPath(name)} is missing; its reviewed policy cannot be enforced`);
    }
  }
  for (const [name, source] of Object.entries(sources)) {
    const named = NAMED_POLICIES[name];
    failures.push(...baselineFailures(name, source, named !== undefined));
    failures.push(...scopedServiceSecretFailures(name, source));
    failures.push(...websiteDeployFailures(name, source));
    failures.push(...vendoringFailures(name, source));
    failures.push(...(named?.(source) ?? []));
  }
  return failures;
};

/**
 * Loads every workflow in the repository and returns all privileged-workflow
 * policy violations. Fails closed: an unreadable workflow directory throws
 * rather than reporting an empty violation list.
 */
export const workflowSecurityFailures = async (): Promise<string[]> =>
  workflowSecurityPolicyFailures(await readWorkflowSources());
