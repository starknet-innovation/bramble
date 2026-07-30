/**
 * Regression tests for privileged GitHub Actions trust-boundary policy.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";

const paths = {
  ci: ".github/workflows/ci.yml",
  nightly: ".github/workflows/nightly.yml",
  releaseBuild: ".github/workflows/release-build.yml",
  releaseIntegration: ".github/workflows/release-integration.yml",
  release: ".github/workflows/release.yml",
  roadmap: ".github/workflows/roadmap-project-sync.yml",
} as const;

type WorkflowName = keyof typeof paths;
const GITHUB_EXPRESSION = "$" + "{{";
const SHELL_EXPANSION = "$" + "{";

const readWorkflows = async (): Promise<Record<WorkflowName, string>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([name, path]) => [name, await readFile(path, "utf8")]),
    ),
  ) as Record<WorkflowName, string>;

const mutate = (
  sources: Record<WorkflowName, string>,
  workflow: WorkflowName,
  search: string,
  replacement: string,
): Record<WorkflowName, string> => {
  expect(sources[workflow]).toContain(search);
  return { ...sources, [workflow]: sources[workflow].replace(search, replacement) };
};

describe("workflow security policy", () => {
  test("accepts the repository workflows", async () => {
    expect(workflowSecurityPolicyFailures(await readWorkflows())).toEqual([]);
  });

  const cases = [
    {
      name: "rejects fork-capable self-hosted release validation",
      workflow: "ci",
      search: "github.event.pull_request.head.repo.full_name == github.repository",
      replacement: "github.event.pull_request.head.repo.full_name != ''",
      failure:
        "release-validation must reject fork-controlled branches before using the self-hosted runner",
    },
    {
      name: "rejects a moving Rust toolchain",
      workflow: "ci",
      search: "toolchain: 1.96.1",
      replacement: "toolchain: stable",
      failure: ".github/workflows/ci.yml must pin Rust toolchain 1.96.1",
    },
    {
      name: "rejects release builds without the pinned privacy SDK",
      workflow: "releaseBuild",
      search: "- run: bun run vendor:privacy",
      replacement: "- run: echo privacy-sdk-skipped",
      failure: ".github/workflows/release-build.yml must vendor the pinned privacy SDK",
    },
    {
      name: "rejects a moving privacy SDK build runtime",
      workflow: "nightly",
      search: "node-version: 24",
      replacement: "node-version: latest",
      failure: ".github/workflows/nightly.yml must pin Node.js 24 for privacy SDK vendoring",
    },
    {
      name: "rejects write permission in the self-hosted release build",
      workflow: "releaseBuild",
      search: "build-release:\n    permissions:\n      contents: read",
      replacement: "build-release:\n    permissions:\n      contents: write",
      failure: "self-hosted release builds must have read-only repository permission",
    },
    {
      name: "rejects caller-controlled release checkout refs",
      workflow: "releaseBuild",
      search:
        "with:\n          fetch-depth: 0\n          fetch-tags: true\n      - name: Check out immutable release commit",
      replacement: `with:\n          ref: ${GITHUB_EXPRESSION} inputs.commit_sha }}\n          fetch-depth: 0\n          fetch-tags: true\n      - name: Check out immutable release commit`,
      failure: "self-hosted release builds must not pass caller-controlled refs to checkout",
    },
    {
      name: "rejects release publishing that executes checked-out source",
      workflow: "releaseBuild",
      search: "steps:\n      - uses: actions/download-artifact@",
      replacement:
        "steps:\n      - uses: actions/checkout@0000000000000000000000000000000000000000\n      - uses: actions/download-artifact@",
      failure: "the hosted release publisher must not check out or execute wallet source",
    },
    {
      name: "rejects manual store publishing without an immutable tag",
      workflow: "release",
      search: `git ls-remote --exit-code --tags origin "refs/tags/${SHELL_EXPANSION}tag}"`,
      replacement: `git show-ref --verify "refs/heads/${SHELL_EXPANSION}tag}"`,
      failure: "manual store publication must require an existing immutable release tag",
    },
    {
      name: "rejects an unconstrained nightly branch",
      workflow: "nightly",
      search: '[[ ! "$candidate" =~ ^release/v[0-9]+\\.[0-9]+$ ]]',
      replacement: '[[ -z "$candidate" ]]',
      failure: "nightly must constrain configured refs to canonical release branches",
    },
    {
      name: "rejects configured nightly checkout refs",
      workflow: "nightly",
      search:
        "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n      - name: Check out resolved release commit",
      replacement: `uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: ${GITHUB_EXPRESSION} needs.resolve.outputs.branch }}\n      - name: Check out resolved release commit`,
      failure: "self-hosted nightly execution must not pass configured refs to checkout",
    },
    {
      name: "rejects pull-request execution with the roadmap token",
      workflow: "roadmap",
      search: "pull_request_target:",
      replacement: "pull_request:",
      failure: "roadmap token verification must execute the trusted base workflow",
    },
  ] as const;

  for (const item of cases) {
    test(item.name, async () => {
      const sources = await readWorkflows();
      const changed = mutate(sources, item.workflow, item.search, item.replacement);
      expect(workflowSecurityPolicyFailures(changed)).toContain(item.failure);
    });
  }
});
