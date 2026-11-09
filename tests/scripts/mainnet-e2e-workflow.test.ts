/**
 * The live mainnet workflow's reviewed controls. One mutation at a time, on
 * the workflow text, so a dropped guard fails here rather than in production.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAINNET_E2E_WORKFLOW_NAME } from "../../scripts/mainnet-e2e-guard";
import { rpcUrlSha256 } from "../../scripts/mainnet-e2e-rpc";
import { EXECUTE_ORDER, SECRETS_STEP_FAILURE } from "../../scripts/mainnet-e2e-workflow-execute";
import { REPORT_ORDER } from "../../scripts/mainnet-e2e-workflow-jobs";
import { mainnetE2eWorkflowFailures } from "../../scripts/mainnet-e2e-workflow-policy";
import { CHECKOUT_FAILURE } from "../../scripts/mainnet-e2e-workflow-steps";
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
    expect(mainnetE2eWorkflowFailures(persisted[WORKFLOW] ?? "")).toContain(CHECKOUT_FAILURE);
    const ref = mutate(
      sources,
      "          persist-credentials: false\n",
      "          persist-credentials: false\n          ref: release/v0.10.9\n",
    );
    expect(mainnetE2eWorkflowFailures(ref[WORKFLOW] ?? "")).toContain(CHECKOUT_FAILURE);
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
      "    env:\n      PLAYWRIGHT_BROWSERS_PATH:",
      `    env:\n      MAINNET_E2E_PRIVATE_KEY: ${EXPRESSION} secrets.MAINNET_E2E_PRIVATE_KEY }}\n      PLAYWRIGHT_BROWSERS_PATH:`,
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
      "the resolve job must run exactly the reviewed steps, in order",
    );
    const withCheckout = mutate(
      sources,
      "      - name: Upsert mainnet tracking issue\n",
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n        with:\n          persist-credentials: false\n      - name: Upsert mainnet tracking issue\n",
    );
    expect(mainnetE2eWorkflowFailures(withCheckout[WORKFLOW] ?? "")).toContain(REPORT_ORDER);
  });

  test("keeps install and build off the runner that holds the key", async () => {
    const sources = await readWorkflowSources();
    const install = mutate(
      sources,
      "      - name: Check and mask mainnet secrets\n",
      "      - run: bun install --frozen-lockfile\n      - name: Check and mask mainnet secrets\n",
    );
    expect(mainnetE2eWorkflowFailures(install[WORKFLOW] ?? "")).toContain(EXECUTE_ORDER);
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
    const lenient = mutate(
      sources,
      'type == "number" and . >= 0 and . <= 999999 and . == floor',
      "true",
    );
    expect(mainnetE2eWorkflowFailures(lenient[WORKFLOW] ?? "")).toContain(
      "mainnet execution must fail on a malformed Playwright report",
    );
    for (const [message, expected] of [
      [
        '"::error::Playwright mainnet executed no passing test."; exit 1',
        "mainnet execution must fail when Playwright executed no test",
      ],
      [
        '"::error::Playwright mainnet failed. Output is withheld in CI; rerun locally for details."; exit 1',
        "mainnet execution must fail when a Playwright test fails or is flaky",
      ],
      [
        '"::error::Gasless mainnet failed. Output is withheld in CI; rerun locally for details."; exit 1',
        "mainnet execution must fail unless the gasless send succeeded",
      ],
    ] as const) {
      const stripped = mutate(sources, message, message.replace("; exit 1", ""));
      expect(mainnetE2eWorkflowFailures(stripped[WORKFLOW] ?? "")).toContain(expected);
    }
    const printed = mutate(
      sources,
      "          set +e\n          bun run test:mainnet",
      '          cat "$RUNNER_TEMP/x"\n          set +e\n          bun run test:mainnet',
    );
    // Scripts are compared whole, so no printer can join one.
    expect(mainnetE2eWorkflowFailures(printed[WORKFLOW] ?? "")).toContain(
      "mainnet execution must fail unless the gasless send succeeded",
    );
    const skipped = mutate(
      sources,
      `if [ "\${#missing[@]}" -ne 0 ]; then`,
      `if [ "\${#missing[@]}" -eq 3 ]; then echo "ready=false"; fi\n          if false; then`,
    );
    const failures = mainnetE2eWorkflowFailures(skipped[WORKFLOW] ?? "");
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
    ).toContain(SECRETS_STEP_FAILURE);
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
    // Dropping any refusal's `exit 1` turns a failure into a warning.
    for (const [message, expected] of [
      ['"::error::The mainnet-e2e RPC is not the one preflight validated."; exit 1', same],
      ['"::error::The mainnet RPC must be HTTPS."; exit 1', refused],
      ['"::error::The mainnet RPC must be a dedicated test endpoint."; exit 1', refused],
      [
        '"::error::The mainnet RPC is unavailable or not mainnet. CI does not fall back."; exit 1',
        refused,
      ],
    ] as const) {
      expect(failuresAfter(message, message.replace("; exit 1", ""))).toContain(expected);
    }
    const source = sources[WORKFLOW] ?? "";
    const chainCheck = source.indexOf('          if [ "${chain,,}" != "0x534e5f4d41494e" ]; then');
    const chainEnd = source.indexOf("          fi\n", chainCheck) + "          fi\n".length;
    const gasless = source.indexOf("      - name: Gasless mainnet\n");
    expect(chainCheck).toBeGreaterThan(0);
    const moved = `${source.slice(0, chainCheck)}${source.slice(chainEnd, gasless)}      - name: Late RPC check\n        run: |\n${source.slice(chainCheck, chainEnd)}${source.slice(gasless)}`;
    expect(mainnetE2eWorkflowFailures(moved)).toContain(EXECUTE_ORDER);
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

  test("the RPC validation step exits before any test on a hash mismatch", async () => {
    const source = (await readWorkflowSources())[WORKFLOW] ?? "";
    const start = source.indexOf('          actual="$(printf \'%s\' "$MAINNET_E2E_RPC_URL"');
    const chain = source.indexOf('          if [ "${chain,,}"', start);
    const end = source.indexOf("          fi\n", chain) + "          fi\n".length;
    expect(start).toBeGreaterThan(0);
    const url = "https://rpc.example/v0_10";
    // The workflow's whole validation step, curl stubbed to answer mainnet.
    const script = [
      "set -euo pipefail",
      `curl() { cat >/dev/null; printf '%s\\n200' '{"result":"0x534e5f4d41494e"}'; }`,
      source.slice(start, end),
      "echo TESTS_WOULD_RUN",
    ].join("\n");
    const run = (rpcUrl: string, hash: string) =>
      Bun.spawnSync(["bash", "-c", script], {
        env: {
          MAINNET_E2E_RPC_URL: rpcUrl,
          PATH: process.env["PATH"] ?? "",
          PREFLIGHT_RPC_SHA256: hash,
        },
      });
    const validated = rpcUrlSha256(url);
    const ok = run(url, validated);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.toString()).toContain("TESTS_WOULD_RUN");
    for (const [rpcUrl, hash] of [
      ["https://other-rpc.example/v0_10", validated],
      [url, ""],
      [url, "0".repeat(64)],
    ] as const) {
      const refused = run(rpcUrl, hash);
      expect(refused.exitCode).not.toBe(0);
      expect(refused.stdout.toString()).not.toContain("TESTS_WOULD_RUN");
      expect(refused.stdout.toString()).toContain("not the one preflight validated");
      expect(refused.stdout.toString()).not.toContain("other-rpc");
    }
  });

  test("keeps the secrets step id and ends execute on a passed gasless send", async () => {
    const sources = await readWorkflowSources();
    const failuresAfter = (search: string, replacement: string): string[] =>
      mainnetE2eWorkflowFailures(mutate(sources, search, replacement)[WORKFLOW] ?? "");
    for (const renamed of ["        id: check\n", "        id: secrets2\n", ""]) {
      const failures = failuresAfter("        id: secrets\n", renamed);
      expect(failures).toContain(SECRETS_STEP_FAILURE);
      expect(failures).toContain(EXECUTE_ORDER);
    }
    expect(
      failuresAfter(
        "if: steps.secrets.outcome == 'success' && steps.playwright.outcome != 'failure'",
        "if: steps.playwright.outcome != 'failure'",
      ),
    ).toContain("mainnet execution must run the gasless send only after the secrets step passed");
    const guarded = "mainnet execution must end by requiring a passed gasless send";
    const step = (source: string): string => {
      const at = source.indexOf("      - name: Require the gasless send\n");
      return source.slice(at, source.indexOf("\n\n", at) + 1);
    };
    const source = sources[WORKFLOW] ?? "";
    expect(failuresAfter(step(source), "")).toContain(guarded);
    expect(failuresAfter('[ "$GASLESS" = passed ]', '[ "$GASLESS" != x ]')).toContain(guarded);
    expect(failuresAfter("not pass.\"; exit 1; }'", "not pass.\"; }'")).toContain(guarded);
    expect(
      failuresAfter("        if: always()\n        env: { GASLESS", "        env: { GASLESS"),
    ).toContain(guarded);
  });

  test("the final guard fails execute unless the gasless send passed", async () => {
    const source = (await readWorkflowSources())[WORKFLOW] ?? "";
    const marker = '        run: \'[ "$GASLESS" = passed ]';
    const at = source.indexOf(marker);
    expect(at).toBeGreaterThan(0);
    const line = source.slice(at + "        run: '".length, source.indexOf("\n", at) - 1);
    const run = (gasless: string): number | null =>
      Bun.spawnSync(["bash", "-c", line], {
        env: { GASLESS: gasless, PATH: process.env["PATH"] ?? "" },
      }).exitCode;
    expect(run("passed")).toBe(0);
    for (const result of ["", "failed", "skipped", "passed ", "PASSED"]) {
      expect(run(result)).not.toBe(0);
    }
  });

  test("the Playwright and gasless wrappers never report passed without a real pass", async () => {
    const source = (await readWorkflowSources())[WORKFLOW] ?? "";
    const runOf = (step: string): string => {
      const at = source.indexOf(`      - name: ${step}\n`);
      const start = source.indexOf("        run: |\n", at) + "        run: |\n".length;
      const end = source.indexOf("\n\n", start);
      const next = source.indexOf("      - name: ", start);
      expect(at).toBeGreaterThan(0);
      return source
        .slice(start, next > 0 && next < end ? next : end)
        .split("\n")
        .map((line) => line.slice(10))
        .join("\n");
    };
    const dir = await mkdtemp(join(tmpdir(), "mainnet-wrapper-"));
    // `bun` is stubbed: it writes the fixture and exits with FAKE_STATUS.
    const wrapper = (step: string, stub: string, fixture: string, status: number) => {
      const output = join(dir, `output-${Math.random().toString(16).slice(2)}`);
      const run = Bun.spawnSync(
        ["bash", "-c", `bun() { ${stub}; return "$FAKE_STATUS"; }\n${runOf(step)}`],
        {
          env: {
            FAKE_FIXTURE: fixture,
            FAKE_STATUS: String(status),
            GITHUB_OUTPUT: output,
            PATH: process.env["PATH"] ?? "",
            RUNNER_TEMP: dir,
          },
        },
      );
      const outputs = run.exitCode === null ? "" : readFileSync(output, "utf8");
      return { code: run.exitCode, passed: outputs.includes("result=passed") };
    };
    const playwright = (stats: string, status: number) =>
      wrapper(
        "Playwright mainnet",
        'printf "%s" "$FAKE_FIXTURE" > "$PLAYWRIGHT_JSON_OUTPUT_FILE"',
        `{"stats":${stats}}`,
        status,
      );
    expect(playwright('{"expected":1,"unexpected":0,"flaky":0,"skipped":0}', 0)).toEqual({
      code: 0,
      passed: true,
    });
    for (const [stats, status] of [
      ['{"expected":0,"unexpected":0,"flaky":0,"skipped":0}', 0],
      ['{"expected":0,"unexpected":0,"flaky":0,"skipped":3}', 0],
      ['{"expected":1,"unexpected":1,"flaky":0,"skipped":0}', 0],
      ['{"expected":1,"unexpected":0,"flaky":1,"skipped":0}', 0],
      ['{"expected":1,"unexpected":0,"flaky":0,"skipped":0}', 1],
      // Malformed counts must not slip past the integer tests.
      ['{"expected":"0\\n0","unexpected":0,"flaky":0,"skipped":0}', 0],
      ['{"expected":"1\\n1","unexpected":0,"flaky":0,"skipped":0}', 0],
      ['{"expected":-1,"unexpected":0,"flaky":0,"skipped":0}', 0],
      ['{"expected":1,"unexpected":"x","flaky":0,"skipped":0}', 0],
      ['{"expected":1,"unexpected":false,"flaky":null,"skipped":0}', 0],
      ['{"expected":1,"unexpected":0,"flaky":0}', 0],
      ['{"expected":1,"unexpected":null,"flaky":0,"skipped":0}', 0],
      ['{"expected":1,"unexpected":0,"flaky":false,"skipped":0}', 0],
      ['{"expected":"1","unexpected":0,"flaky":0,"skipped":0}', 0],
      ['{"expected":1.5,"unexpected":0,"flaky":0,"skipped":0}', 0],
      ['{"expected":1,"unexpected":0,"flaky":0,"skipped":1000000}', 0],
      ['{"expected":0.0,"unexpected":0,"flaky":0,"skipped":0}', 0],
      ['{"expected":1,"unexpected":1.0,"flaky":0,"skipped":0}', 0],
    ] as const) {
      const result = playwright(stats, status);
      expect(result.code).not.toBe(0);
      expect(result.passed).toBe(false);
    }
    // Only one report document is accepted; an empty report is malformed.
    for (const fixture of [
      '{"stats":{"expected":1,"unexpected":0,"flaky":0,"skipped":0}}{"stats":{"expected":0,"unexpected":1,"flaky":0,"skipped":0}}',
      "",
    ]) {
      const result = wrapper(
        "Playwright mainnet",
        'printf "%s" "$FAKE_FIXTURE" > "$PLAYWRIGHT_JSON_OUTPUT_FILE"',
        fixture,
        0,
      );
      expect(result.code).not.toBe(0);
      expect(result.passed).toBe(false);
    }
    const gasless = (log: string, status: number) =>
      wrapper("Gasless mainnet", 'printf "%s\\n" "$FAKE_FIXTURE"', log, status);
    const sent = "paymaster_isAvailable: true\nSuccess. Fee 5232 0x1. No STRK fee.";
    expect(gasless(sent, 0)).toEqual({ code: 0, passed: true });
    for (const [log, status] of [
      ["Skipping gasless mainnet test: no account", 0],
      ["paymaster_isAvailable: true", 0],
      ["Success. Fee 5232 0x1. No STRK fee.", 0],
      [`${sent}\nSkipping gasless mainnet test`, 0],
      [sent, 1],
    ] as const) {
      const result = gasless(log, status);
      expect(result.code).not.toBe(0);
      expect(result.passed).toBe(false);
    }
  });
});
