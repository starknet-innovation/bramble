/**
 * Trunk-based development invariants (DEVELOPMENT.md): `main` is the only
 * long-lived branch, every scheduled suite tests `main` at an immutable commit,
 * the heavy self-hosted pipeline never runs fork code, the PR guards are
 * advisory, and a release tag ships only if its commit is on `main`. Each case
 * mutates one control in the real workflow and expects the policy to name it.
 */
import { describe, expect, test } from "bun:test";
import { readWorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";

const GITHUB_EXPRESSION = "$" + "{{";

const cases = [
  {
    name: "rejects a nightly that tests a configured branch instead of main",
    workflow: "nightly.yml",
    search: "repos/$GITHUB_REPOSITORY/commits/main",
    replacement: "repos/$GITHUB_REPOSITORY/commits/$ACTIVE_RELEASE_BRANCH",
    failure: "nightly must resolve main to a commit",
  },
  {
    name: "rejects a nightly that accepts an unverified revision",
    workflow: "nightly.yml",
    search: '[[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]',
    replacement: '[[ -z "$revision" ]]',
    failure: "nightly must require main to resolve to an immutable commit",
  },
  {
    name: "rejects reintroducing the active release branch variable",
    workflow: "nightly.yml",
    search: "          EVENT_NAME: ",
    replacement: `          ACTIVE_RELEASE_BRANCH: ${GITHUB_EXPRESSION} vars.ACTIVE_RELEASE_BRANCH }}\n          EVENT_NAME: `,
    failure: "nightly must test main, not a configured release branch",
  },
  {
    name: "rejects a nightly dispatch input that selects the tested ref",
    workflow: "nightly.yml",
    search: "          TRIGGER_REF: ",
    replacement: `          INPUT_BRANCH: ${GITHUB_EXPRESSION} github.event.inputs.branch }}\n          TRIGGER_REF: `,
    failure: "nightly must not accept a dispatch input that selects what it tests",
  },
  {
    name: "rejects nightly manual dispatches from outside main",
    workflow: "nightly.yml",
    search: '[ "$TRIGGER_REF" != "refs/heads/main" ]',
    replacement: '[ -z "$TRIGGER_REF" ]',
    failure: "nightly manual dispatches must reject workflow revisions outside main",
  },
  {
    name: "rejects a release tag that is not checked against main",
    workflow: "release.yml",
    search: 'if ! git merge-base --is-ancestor "$commit_sha" refs/remotes/origin/main; then',
    replacement: "if false; then",
    failure: "releases must refuse a tag whose commit is not reachable from main",
  },
  {
    name: "rejects a main-ancestry check against a stale main",
    workflow: "release.yml",
    search: 'git fetch --no-tags origin "+refs/heads/main:refs/remotes/origin/main"\n',
    replacement: "",
    failure: "release preparation must fetch the current main before checking ancestry",
  },
  {
    name: "rejects CI on pull requests into another branch",
    workflow: "ci.yml",
    search: "types: [opened, synchronize, reopened, edited]\n    branches: [main]\n",
    replacement:
      'types: [opened, synchronize, reopened, edited]\n    branches: [main, "release/**"]\n',
    failure: "CI must run on pull requests into main and on pushes to main only",
  },
  {
    name: "rejects a blocking PR guard",
    workflow: "ci.yml",
    search: "            await s.write();\n",
    replacement: '            await s.write();\n            core.setFailed("bad branch name");\n',
    failure: "pr-guards must stay advisory and never fail a pull request",
  },
  {
    name: "rejects release validation on any pull request event",
    workflow: "ci.yml",
    search: "      (github.event_name == 'push' ||\n",
    replacement: "      (github.event_name != '' ||\n",
    failure: "release-validation must run only on pushes to main and same-repository pull requests",
  },
  {
    name: "rejects self-hosted release validation that persists the checkout token",
    workflow: "ci.yml",
    search: "        with:\n          persist-credentials: false\n",
    replacement: "",
    failure: "self-hosted release validation must not leave the checkout token in .git/config",
  },
] as const;

describe("trunk-based workflow policy", () => {
  for (const item of cases) {
    test(item.name, async () => {
      const sources = await readWorkflowSources();
      const source = sources[item.workflow] ?? "";
      expect(source).toContain(item.search);
      const changed = {
        ...sources,
        [item.workflow]: source.replace(item.search, item.replacement),
      };
      expect(workflowSecurityPolicyFailures(changed)).toContain(item.failure);
    });
  }

  test("no workflow references the retired release-branch model", async () => {
    const sources = await readWorkflowSources();
    for (const name of ["release-integration.yml", "auto-release.yml"]) {
      expect(Object.keys(sources)).not.toContain(name);
    }
    for (const [name, source] of Object.entries(sources)) {
      expect({ name, hit: /ACTIVE_RELEASE_BRANCH|release\/\*\*|hotfix\//.test(source) }).toEqual({
        name,
        hit: false,
      });
    }
  });
});
