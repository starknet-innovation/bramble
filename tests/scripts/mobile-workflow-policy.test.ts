/**
 * Regression tests for the mobile workflow's reviewed policy
 * (scripts/mobile-workflow-policy.ts). Each case mutates one control in the real
 * workflow and expects the named failure, so the suite fails if the workflow
 * drifts away from the text these controls read.
 */
import { describe, expect, test } from "bun:test";
import { MOBILE_WORKFLOW } from "../../scripts/mobile-workflow-policy";
import { readWorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";

const GITHUB_EXPRESSION = "$" + "{{";
const PATH = `.github/workflows/${MOBILE_WORKFLOW}`;

const mutated = async (search: string, replacement: string): Promise<string[]> => {
  const sources = await readWorkflowSources();
  const source = sources[MOBILE_WORKFLOW] ?? "";
  expect(source).toContain(search);
  return workflowSecurityPolicyFailures({
    ...sources,
    [MOBILE_WORKFLOW]: source.replace(search, replacement),
  });
};

describe("mobile workflow policy", () => {
  test("the mobile workflow is inventoried and accepted", async () => {
    const sources = await readWorkflowSources();
    expect(Object.keys(sources)).toContain(MOBILE_WORKFLOW);
    expect(workflowSecurityPolicyFailures(sources)).toEqual([]);
  });

  test("rejects removing the workflow, which would shed its reviewed rules", async () => {
    const { [MOBILE_WORKFLOW]: _removed, ...rest } = await readWorkflowSources();
    expect(workflowSecurityPolicyFailures(rest)).toContain(
      `${PATH} is missing; its reviewed policy cannot be enforced`,
    );
  });

  const cases = [
    {
      name: "rejects the self-hosted runner",
      search: "  lint:\n    runs-on: macos-15",
      replacement: "  lint:\n    runs-on: codebuild-gha-runner-mc-wallet",
      failure: `${PATH} must run on ubuntu-latest or macos-15, not \`codebuild-gha-runner-mc-wallet\``,
    },
    {
      name: "rejects a privileged pull_request_target trigger",
      search: "on:\n  pull_request:\n",
      replacement: "on:\n  pull_request_target:\n",
      failure: `${PATH} must not use the privileged pull_request_target: trigger`,
    },
    {
      name: "rejects a workflow_run trigger",
      search: "on:\n  pull_request:\n",
      replacement: "on:\n  workflow_run:\n    workflows: [CI]\n  pull_request:\n",
      failure: `${PATH} must not use the privileged workflow_run: trigger`,
    },
    {
      name: "rejects a write permission",
      search: "permissions:\n  contents: read\n",
      replacement: "permissions:\n  contents: read\n  pull-requests: write\n",
      failure: `${PATH} must not request any write permission`,
    },
    {
      name: "rejects reading a repository secret",
      search: "      - run: cargo test --locked",
      replacement: `      - run: cargo test --locked\n        env:\n          TOKEN: ${GITHUB_EXPRESSION} secrets.GITHUB_TOKEN }}`,
      failure: `${PATH} must not read repository secrets`,
    },
    {
      name: "rejects a checkout that persists the token",
      search: "        with:\n          persist-credentials: false\n      - name: Select Xcode",
      replacement: "      - name: Select Xcode",
      failure: `${PATH} must check out with persist-credentials: false in every job`,
    },
    {
      name: "rejects a tool resolved by name at run time",
      search: "      - run: bun run mobile:lint",
      replacement: "      - run: npx some-linter",
      failure: `${PATH} must not run \`npx\`: it downloads and runs whatever package currently answers that name`,
    },
  ] as const;

  for (const item of cases) {
    test(item.name, async () => {
      expect(await mutated(item.search, item.replacement)).toContain(item.failure);
    });
  }
});
