/**
 * The live mainnet workflow's reviewed controls. One mutation at a time, on
 * the workflow text, so a dropped guard fails here rather than in production.
 */
import { describe, expect, test } from "bun:test";
import { MAINNET_E2E_WORKFLOW_NAME } from "../../scripts/mainnet-e2e-guard";
import { mainnetE2eWorkflowFailures } from "../../scripts/mainnet-e2e-workflow-policy";
import { readWorkflowSources, type WorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";

const WORKFLOW = "mainnet-e2e.yml";
const EXPRESSION = "$" + "{{";
const KEY_BINDING = `GASLESS_E2E_PRIVATE_KEY: ${EXPRESSION} secrets.MAINNET_E2E_PRIVATE_KEY }}`;

const mutate = (sources: WorkflowSources, search: string, replacement: string): WorkflowSources => {
  const source = sources[WORKFLOW] ?? "";
  expect(source).toContain(search);
  return { ...sources, [WORKFLOW]: source.replace(search, replacement) };
};

describe("mainnet E2E workflow policy", () => {
  test("accepts the repository workflows", async () => {
    const sources = await readWorkflowSources();
    expect(sources[WORKFLOW]?.startsWith(`name: ${MAINNET_E2E_WORKFLOW_NAME}\n`)).toBe(true);
    expect(mainnetE2eWorkflowFailures(sources[WORKFLOW] ?? "")).toEqual([]);
    expect(workflowSecurityPolicyFailures(sources)).toEqual([]);
  });

  test("rejects a pull_request trigger", async () => {
    const sources = await readWorkflowSources();
    const changed = mutate(sources, "  schedule:", "  pull_request:");
    expect(workflowSecurityPolicyFailures(changed)).toContain(
      ".github/workflows/mainnet-e2e.yml must not trigger on pull_request:",
    );
  });

  test("rejects cancelling an in-flight mainnet run", async () => {
    const sources = await readWorkflowSources();
    const changed = mutate(sources, "cancel-in-progress: false", "cancel-in-progress: true");
    expect(mainnetE2eWorkflowFailures(changed[WORKFLOW] ?? "")).toContain(
      ".github/workflows/mainnet-e2e.yml must queue on mainnet-e2e and must not cancel an in-flight run",
    );
  });

  test("rejects a checkout that keeps the token or takes a caller ref", async () => {
    const sources = await readWorkflowSources();
    const persisted = mutate(sources, "          persist-credentials: false\n", "");
    expect(mainnetE2eWorkflowFailures(persisted[WORKFLOW] ?? "")).toContain(
      ".github/workflows/mainnet-e2e.yml must not leave a checkout token in .git/config",
    );
    const ref = mutate(
      sources,
      "          persist-credentials: false\n",
      "          persist-credentials: false\n          ref: release/v0.10.9\n",
    );
    expect(mainnetE2eWorkflowFailures(ref[WORKFLOW] ?? "")).toContain(
      ".github/workflows/mainnet-e2e.yml must not pass configured refs to checkout",
    );
  });

  test("rejects an extra or hoisted hot-wallet key binding", async () => {
    const sources = await readWorkflowSources();
    const extra = mutate(
      sources,
      `          ${KEY_BINDING}\n`,
      `          ${KEY_BINDING}\n          COPIED_KEY: ${EXPRESSION} secrets.MAINNET_E2E_PRIVATE_KEY }}\n`,
    );
    expect(mainnetE2eWorkflowFailures(extra[WORKFLOW] ?? "")).toContain(
      ".github/workflows/mainnet-e2e.yml must bind the hot-wallet private key in exactly 5 step env values, all in execute",
    );
    const hoisted = mutate(
      sources,
      "  execute:\n",
      `  execute:\n    env:\n      MAINNET_E2E_PRIVATE_KEY: ${EXPRESSION} secrets.MAINNET_E2E_PRIVATE_KEY }}\n`,
    );
    expect(mainnetE2eWorkflowFailures(hoisted[WORKFLOW] ?? "")).toContain(
      ".github/workflows/mainnet-e2e.yml must bind the hot-wallet private key only as a step env value",
    );
  });

  test("rejects an artifact upload outside the build and a reporter that checks out source", async () => {
    const sources = await readWorkflowSources();
    const uploaded = mutate(
      sources,
      "    steps:\n",
      "    steps:\n      - uses: actions/upload-artifact@0000000000000000000000000000000000000000\n",
    );
    expect(mainnetE2eWorkflowFailures(uploaded[WORKFLOW] ?? "")).toContain(
      ".github/workflows/mainnet-e2e.yml may upload artifacts only from the keyless build job",
    );
    const report = sources[WORKFLOW]?.indexOf("  report:\n") ?? -1;
    expect(report).toBeGreaterThan(0);
    const source = sources[WORKFLOW] ?? "";
    const withCheckout = `${source.slice(0, report)}  report:\n    steps:\n      - uses: actions/checkout@0000000000000000000000000000000000000000\n${source.slice(report + "  report:\n".length)}`;
    expect(mainnetE2eWorkflowFailures(withCheckout)).toContain(
      "the hosted mainnet reporter must not check out or execute release-branch source",
    );
  });

  test("keeps install and build off the runner that holds the key", async () => {
    const sources = await readWorkflowSources();
    const install = mutate(
      sources,
      "      - name: Check and mask mainnet secrets\n",
      "      - run: bun install --frozen-lockfile\n      - name: Check and mask mainnet secrets\n",
    );
    expect(mainnetE2eWorkflowFailures(install[WORKFLOW] ?? "")).toContain(
      "mainnet execution must not run bun install; install and build in the keyless build job",
    );
    const keyed = mutate(
      sources,
      "      - name: Install dependencies\n        run: bun install --frozen-lockfile\n",
      `      - name: Install dependencies\n        env:\n          RPC: ${EXPRESSION} secrets.MAINNET_E2E_RPC_URL }}\n        run: bun install --frozen-lockfile\n`,
    );
    expect(mainnetE2eWorkflowFailures(keyed[WORKFLOW] ?? "")).toContain(
      "the mainnet build runs release code and must not receive any secret",
    );
  });

  test("keeps the spend baseline and balance checks out of reach of the tests", async () => {
    const sources = await readWorkflowSources();
    const baseline = mutate(
      sources,
      `MAINNET_E2E_STRK_BEFORE_RAW: ${EXPRESSION} needs.preflight.outputs.strk_before_raw }}`,
      `MAINNET_E2E_STRK_BEFORE_RAW: ${EXPRESSION} needs.execute.outputs.strk_before_raw }}`,
    );
    expect(mainnetE2eWorkflowFailures(baseline[WORKFLOW] ?? "")).toContain(
      "the post-run check must take its baseline from the preflight job output",
    );
    const selfHosted = mutate(
      sources,
      "      name: mainnet-e2e-balance\n    permissions:\n      contents: read\n    runs-on: ubuntu-latest\n",
      `      name: mainnet-e2e-balance\n    permissions:\n      contents: read\n    runs-on: codebuild-gha-runner-mc-wallet-${EXPRESSION} github.run_id }}\n`,
    );
    expect(mainnetE2eWorkflowFailures(selfHosted[WORKFLOW] ?? "")).toContain(
      "the preflight balance check must run on a hosted runner, apart from the tests",
    );
  });

  test("fails closed on missing secrets, zero tests, and raw test output", async () => {
    const sources = await readWorkflowSources();
    const zero = mutate(sources, 'if [ "$expected" -eq 0 ]; then', "if false; then");
    expect(mainnetE2eWorkflowFailures(zero[WORKFLOW] ?? "")).toContain(
      "mainnet execution must fail when Playwright executed no test",
    );
    const printed = mutate(
      sources,
      "          set +e\n          bun run test:mainnet",
      '          cat "$RUNNER_TEMP/x"\n          set +e\n          bun run test:mainnet',
    );
    expect(mainnetE2eWorkflowFailures(printed[WORKFLOW] ?? "")).toContain(
      "mainnet execution must not print raw test output; report counts only",
    );
    const skipped = mutate(
      sources,
      `if [ "\${#missing[@]}" -ne 0 ]; then`,
      `if [ "\${#missing[@]}" -eq 3 ]; then echo "ready=false"; fi\n          if false; then`,
    );
    const failures = mainnetE2eWorkflowFailures(skipped[WORKFLOW] ?? "");
    expect(failures).toContain(
      ".github/workflows/mainnet-e2e.yml must fail, not skip green, when it is enabled without its secrets",
    );
    expect(failures).toContain("mainnet execution must fail when any hot-wallet secret is missing");
  });

  test("uses exactly the RPC preflight validated, with no fallback", async () => {
    const sources = await readWorkflowSources();
    const failuresAfter = (search: string, replacement: string): string[] =>
      mainnetE2eWorkflowFailures(mutate(sources, search, replacement)[WORKFLOW] ?? "");
    const same = "mainnet execution must use exactly the RPC preflight validated";
    const refused =
      "mainnet execution must refuse a non-HTTPS, shared, unavailable or non-mainnet RPC";
    expect(
      failuresAfter(`      rpc_sha256: ${EXPRESSION} steps.balance.outputs.rpc_sha256 }}\n`, ""),
    ).toContain("the preflight must publish the hash of the RPC it validated");
    expect(
      failuresAfter(
        `PREFLIGHT_RPC_SHA256: ${EXPRESSION} needs.preflight.outputs.rpc_sha256 }}`,
        `PREFLIGHT_RPC_SHA256: ${EXPRESSION} needs.build.outputs.rpc_sha256 }}`,
      ),
    ).toContain(same);
    expect(
      failuresAfter('[ "$actual" != "$PREFLIGHT_RPC_SHA256" ]; then', "false; then"),
    ).toContain(same);
    expect(failuresAfter('[[ "$MAINNET_E2E_RPC_URL" == https://* ]] || {', "true || {")).toContain(
      refused,
    );
    expect(failuresAfter("--proto '=https' ", "")).toContain(refused);
    expect(
      failuresAfter(
        "wallet.nodes.starknet.org|mainnet.nodes.starknet.org) echo",
        "wallet.nodes.starknet.org) echo",
      ),
    ).toContain(refused);
    expect(
      failuresAfter('if [ "${chain,,}" != "0x534e5f4d41494e" ]; then', "if false; then"),
    ).toContain(refused);
    const source = sources[WORKFLOW] ?? "";
    const chainCheck = source.indexOf('          if [ "${chain,,}" != "0x534e5f4d41494e" ]; then');
    const chainEnd = source.indexOf("          fi\n", chainCheck) + "          fi\n".length;
    const gasless = source.indexOf("      - name: Gasless mainnet\n");
    expect(chainCheck).toBeGreaterThan(0);
    const moved = `${source.slice(0, chainCheck)}${source.slice(chainEnd, gasless)}      - name: Late RPC check\n        run: |\n${source.slice(chainCheck, chainEnd)}${source.slice(gasless)}`;
    expect(mainnetE2eWorkflowFailures(moved)).toContain(
      "mainnet execution must check the RPC in the secrets step, before any live test",
    );
  });

  test("the RPC chain-id probe fails closed on redirects, errors and bad JSON", async () => {
    const source = (await readWorkflowSources())[WORKFLOW] ?? "";
    const start = source.indexOf('          body="$(printf');
    const end = source.indexOf("          fi\n", start) + "          fi\n".length;
    expect(start).toBeGreaterThan(0);
    // The workflow's own probe, with curl stubbed: no network is reached.
    const script = [
      "set -euo pipefail",
      'curl() { cat >/dev/null; printf "%s" "$FAKE_BODY"; return "$FAKE_STATUS"; }',
      "MAINNET_E2E_RPC_URL=https://rpc.example/v0_10",
      source.slice(start, end),
      "echo PROBE_PASSED",
    ].join("\n");
    const probe = (body: string, status: number): boolean => {
      const run = Bun.spawnSync(["bash", "-c", script], {
        env: { FAKE_BODY: body, FAKE_STATUS: String(status), PATH: process.env["PATH"] ?? "" },
      });
      return run.exitCode === 0 && run.stdout.toString().includes("PROBE_PASSED");
    };
    const mainnet = '{"jsonrpc":"2.0","id":1,"result":"0x534e5f4d41494e"}';
    expect(probe(`${mainnet}\n200`, 0)).toBe(true);
    expect(probe(`${mainnet}\n302`, 0)).toBe(false);
    expect(probe(`${mainnet}\n200`, 18)).toBe(false);
    expect(probe(`${mainnet} trailing\n200`, 0)).toBe(false);
    expect(probe('{"result":"0x534e5f5345504f4c4941"}\n200', 0)).toBe(false);
    expect(probe("", 7)).toBe(false);
  });
});
