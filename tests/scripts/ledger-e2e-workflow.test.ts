/**
 * The Speculos Ledger E2E workflow's reviewed controls
 * (scripts/ledger-e2e-workflow-policy.ts). Each case mutates one control in the
 * real workflow text and expects the repository policy to name it.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { readWorkflowSources, type WorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";

const WORKFLOW = "ledger-e2e.yml";
const PATH = `.github/workflows/${WORKFLOW}`;
const EXPRESSION = "$" + "{{";
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const SUITE = "        run: BRAMBLE_SPECULOS_REQUIRED=1 bun run test:e2e:ledger\n";
// The record-hashes job's checkout; the speculos one also carries the nightly
// ref and is covered in ledger-e2e-nightly-target.test.ts.
const RECORD_CHECKOUT = "          persist-credentials: false\n      - uses: oven-sh/setup-bun@";

const mutate = (
  sources: WorkflowSources,
  search: string,
  replacement: string,
  all = false,
): WorkflowSources => {
  const source = sources[WORKFLOW] ?? "";
  expect(source).toContain(search);
  const changed = all
    ? source.replaceAll(search, replacement)
    : source.replace(search, replacement);
  return { ...sources, [WORKFLOW]: changed };
};

const failuresAfter = async (search: string, replacement: string, all = false) =>
  workflowSecurityPolicyFailures(mutate(await readWorkflowSources(), search, replacement, all));

describe("Ledger E2E workflow policy", () => {
  test("accepts the repository workflow", async () => {
    const sources = await readWorkflowSources();
    expect(sources[WORKFLOW]).toContain(SUITE);
    expect(workflowSecurityPolicyFailures(sources)).toEqual([]);
  });

  test("a missing workflow fails rather than dropping its rules", async () => {
    const { [WORKFLOW]: _removed, ...rest } = await readWorkflowSources();
    expect(workflowSecurityPolicyFailures(rest)).toContain(
      `${PATH} is missing; its reviewed policy cannot be enforced`,
    );
  });

  test("rejects any secret, in any spelling or position", async () => {
    const secret = `${PATH} must not use any repository secret`;
    for (const [reference, message] of [
      ["secrets.LEDGER_TOKEN", secret],
      ["secrets['ledger_token']", secret],
      ["toJSON( SECRETS )", secret],
      ["github.token", `${PATH} must not hand the GitHub token to a step`],
    ] as const) {
      const failures = await failuresAfter(
        SUITE,
        `        env:\n          LEAK: ${EXPRESSION} ${reference} }}\n${SUITE}`,
      );
      expect(failures).toContain(message);
    }
    expect(
      await failuresAfter(
        "    timeout-minutes: 90\n",
        "    timeout-minutes: 90\n    secrets: inherit\n",
      ),
    ).toContain(`${PATH} job speculos must not declare secrets`);
  });

  test("rejects write permissions, top level or per job", async () => {
    expect(
      await failuresAfter(
        "\npermissions:\n  contents: read\n",
        "\npermissions:\n  contents: write\n",
      ),
    ).toContain(`${PATH} must grant only contents: read`);
    expect(
      await failuresAfter(
        "\npermissions:\n  contents: read\n",
        "\npermissions:\n  contents: read\n  pull-requests: write\n",
      ),
    ).toContain(`${PATH} must not request write permissions`);
    expect(
      await failuresAfter(
        "    timeout-minutes: 90\n",
        "    timeout-minutes: 90\n    permissions:\n      contents: read\n",
      ),
    ).toContain(`${PATH} job speculos must not declare permissions`);
  });

  test("rejects a self-hosted runner in any form", async () => {
    expect(await failuresAfter("runs-on: ubuntu-latest", "runs-on: self-hosted")).toContain(
      `${PATH} job speculos must run on a GitHub-hosted ubuntu-latest runner`,
    );
    expect(
      await failuresAfter(
        "runs-on: ubuntu-latest",
        `runs-on:\n      - codebuild-gha-runner-mc-wallet-${EXPRESSION} github.run_id }}`,
      ),
    ).toContain(`${PATH} must not name a self-hosted runner`);
  });

  test("rejects a privileged trigger", async () => {
    expect(await failuresAfter("  pull_request:\n", "  pull_request_target:\n")).toContain(
      `${PATH} must not trigger on pull_request_target`,
    );
  });

  test("rejects dropping or overriding BRAMBLE_SPECULOS_REQUIRED=1", async () => {
    const message = `${PATH} must run the suite with BRAMBLE_SPECULOS_REQUIRED=1`;
    expect(await failuresAfter(SUITE, "        run: bun run test:e2e:ledger\n")).toContain(message);
    expect(await failuresAfter(SUITE, SUITE.replace("REQUIRED=1", "REQUIRED=0"))).toContain(
      message,
    );
    expect(
      await failuresAfter(
        "    timeout-minutes: 90\n",
        '    timeout-minutes: 90\n    env:\n      BRAMBLE_SPECULOS_REQUIRED: "0"\n',
      ),
    ).toContain(
      `${PATH} must run the suite only as \`run: BRAMBLE_SPECULOS_REQUIRED=1 bun run test:e2e:ledger\``,
    );
    expect(await failuresAfter(SUITE, `        continue-on-error: true\n${SUITE}`)).toContain(
      `${PATH} must not tolerate a failed step`,
    );
  });

  test("rejects skipping a required step while its text stays in place", async () => {
    expect(await failuresAfter(SUITE, `${SUITE}        if: false\n`)).toContain(
      `${PATH} job speculos must not make a step conditional`,
    );
    expect(
      await failuresAfter(
        "\npermissions:\n",
        "\ndefaults:\n  run:\n    shell: sh\n\npermissions:\n",
      ),
    ).toContain(`${PATH} must not declare workflow-level defaults`);
    expect(await failuresAfter("\njobs:\n", "\njobs: [\n")).toContain(
      `${PATH} must be parseable YAML so its controls can be checked`,
    );
  });

  test("rejects an unpinned action", async () => {
    expect(await failuresAfter(CHECKOUT, "actions/checkout@v7")).toContain(
      `${PATH} job speculos must pin actions/checkout@v7 to a commit SHA`,
    );
  });

  test("rejects a checkout that keeps its token, even behind a comment", async () => {
    const message = `${PATH} must not leave a checkout token in .git/config`;
    expect(await failuresAfter(RECORD_CHECKOUT, "      - uses: oven-sh/setup-bun@")).toContain(
      message,
    );
    expect(
      await failuresAfter(
        `        with:\n${RECORD_CHECKOUT}`,
        "        # persist-credentials: false\n      - uses: oven-sh/setup-bun@",
      ),
    ).toContain(message);
  });

  test("rejects running without the unrecorded-hash gate", async () => {
    expect(
      await failuresAfter(
        "        run: bun run scripts/ledger-app-hashes.ts require nanosp flex\n",
        "        run: echo skipped\n",
      ),
    ).toContain(`${PATH} must fail while the Ledger app hashes are unrecorded`);
  });

  test("record mode runs no tests and never shares a run with the test job", async () => {
    expect(
      await failuresAfter(
        "        run: bun run vendor:ledger-app\n",
        "        run: bun run vendor:ledger-app && bun run test:e2e\n",
      ),
    ).toContain(`${PATH} record mode must not run tests`);
    expect(await failuresAfter(`    if: ${EXPRESSION} !inputs.record_hashes }}\n`, "")).toContain(
      `${PATH} must skip the test job in record mode`,
    );
    expect(await failuresAfter("        shell: bash\n", "")).toContain(
      `${PATH} must report the recorded hashes and fail when one is missing`,
    );
    expect(await failuresAfter("run-name: ", "# run-name: ")).toContain(
      `${PATH} must name a record run as one that runs no tests`,
    );
    expect(
      await failuresAfter(
        "    name: Record Ledger app hashes (no tests run)\n",
        "    name: Speculos Ledger E2E\n",
      ),
    ).toContain(`${PATH} job record-hashes must keep its reviewed name`);
  });

  test("rejects an extra job, a job without a timeout, or a wider artifact", async () => {
    expect(
      await failuresAfter(
        "\njobs:\n",
        "\njobs:\n  extra:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: echo hi\n",
      ),
    ).toContain(`${PATH} must define exactly the jobs record-hashes, speculos`);
    expect(await failuresAfter("    timeout-minutes: 90\n", "")).toContain(
      `${PATH} job speculos must set timeout-minutes`,
    );
    for (const [search, replacement] of [
      ["        if: failure()\n", ""],
      ["          path: test-results/\n", "          path: .\n"],
      ["          retention-days: 7\n", "          retention-days: 90\n"],
    ] as const) {
      expect(await failuresAfter(search, replacement)).toContain(
        `${PATH} must upload only Playwright output, only on failure, kept 7 days`,
      );
    }
  });
  test("rejects controls kept as text but disabled or re-spelled in YAML", async () => {
    const secret = await failuresAfter(
      SUITE,
      `        env:\n          LEAK: "${EXPRESSION} secr\\u0065ts.X }}"\n${SUITE}`,
    );
    expect(secret).toContain(`${PATH} must not use any repository secret`);
    expect(
      await failuresAfter(
        SUITE,
        `        env:\n          LEAK: ${EXPRESSION} github['token'] }}\n${SUITE}`,
      ),
    ).toContain(`${PATH} must not hand the GitHub token to a step`);
    expect(
      await failuresAfter(
        "      - name: Install dependencies\n        run: bun install --frozen-lockfile\n      - uses: actions/setup-node",
        '      - name: Install dependencies\n        run: bun install --frozen-lockfile\n      - "\\u0075ses": actions/setup-node@main\n      - uses: actions/setup-node',
      ),
    ).toContain(`${PATH} job speculos must pin actions/setup-node@main to a commit SHA`);
    expect(
      await failuresAfter(
        "  workflow_dispatch:\n",
        '  "pull_request_targ\\u0065t":\n  workflow_dispatch:\n',
      ),
    ).toContain(`${PATH} must trigger on exactly pull_request, push, schedule, workflow_dispatch`);
    expect(await failuresAfter(SUITE, `        shell: "true {0}"\n${SUITE}`)).toContain(
      `${PATH} job speculos must run steps in the default bash shell`,
    );
  });

  test("pins triggers, the record input and each job's exact commands", async () => {
    expect(await failuresAfter('  schedule:\n    - cron: "30 4 * * *"\n', "")).toContain(
      `${PATH} must trigger on exactly pull_request, push, schedule, workflow_dispatch`,
    );
    expect(await failuresAfter("        type: boolean\n", "        type: string\n")).toContain(
      `${PATH} must offer record mode only as a boolean input, off by default`,
    );
    expect(await failuresAfter('      - "tests/e2e/ledger/**"\n', "")).toContain(
      `${PATH} must run on Ledger changes into main and release branches`,
    );
    expect(
      await failuresAfter(
        "        run: bun run vendor:ledger-app\n",
        "        run: bun run vendor:ledger-app\n      - run: bun run test\n",
      ),
    ).toContain(`${PATH} job record-hashes must run exactly the reviewed commands, in order`);
    expect(await failuresAfter("      - run: bun run build\n", "")).toContain(
      `${PATH} job speculos must run exactly the reviewed commands, in order`,
    );
    expect(await failuresAfter("cancel-in-progress: true", "cancel-in-progress: false")).toContain(
      `${PATH} must cancel superseded runs per mode with a concurrency group`,
    );
  });

  test("pins every action's inputs, so no extra upload or checkout ref slips in", async () => {
    expect(
      await failuresAfter(
        RECORD_CHECKOUT,
        "          persist-credentials: false\n          ref: main\n      - uses: oven-sh/setup-bun@",
      ),
    ).toContain(
      `${PATH} job record-hashes must use exactly the reviewed actions and inputs, in order`,
    );
    expect(
      await failuresAfter(
        "          if-no-files-found: ignore\n",
        '          if-no-files-found: ignore\n      - "\\u0075ses": "actions/upload-artif\\u0061ct@cf430e030ddbb5b0abf93d22962f4752f3646cd9"\n        with:\n          name: extra\n          path: .\n',
      ),
    ).toContain(`${PATH} job speculos must use exactly the reviewed actions and inputs, in order`);
    expect(
      await failuresAfter('      - "bun.lock"\n', '      - "bun.lock"\n      - "!**"\n', true),
    ).toContain(`${PATH} must run on Ledger changes into main and release branches`);
    expect(
      await failuresAfter(
        "        run: bun run scripts/ledger-e2e-results.ts nanosp flex\n",
        "        run: echo ok\n",
      ),
    ).toContain(`${PATH} job speculos must run exactly the reviewed commands, in order`);
  });

  test("the Speculos suite has no way to skip a test", async () => {
    const spec = await readFile("tests/e2e/ledger/ledger.speculos.ts", "utf8");
    expect(spec).not.toMatch(/\.(?:skip|fixme|fail|only)\s*\(/);
    const config = await readFile("playwright.ledger.config.ts", "utf8");
    expect(config).toContain("forbidOnly: true");
    expect(config).toContain("retries: 0");
  });
});
