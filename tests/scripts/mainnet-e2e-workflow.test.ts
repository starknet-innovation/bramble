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
      "self-hosted mainnet execution must not leave the checkout token in .git/config",
    );
    const ref = mutate(
      sources,
      "          persist-credentials: false\n",
      "          persist-credentials: false\n          ref: release/v0.10.9\n",
    );
    expect(mainnetE2eWorkflowFailures(ref[WORKFLOW] ?? "")).toContain(
      "self-hosted mainnet execution must not pass configured refs to checkout",
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
      ".github/workflows/mainnet-e2e.yml must bind the hot-wallet private key in exactly 5 step env values",
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

  test("rejects an artifact upload and a reporter that checks out source", async () => {
    const sources = await readWorkflowSources();
    const uploaded = mutate(
      sources,
      "    steps:\n",
      "    steps:\n      - uses: actions/upload-artifact@0000000000000000000000000000000000000000\n",
    );
    expect(mainnetE2eWorkflowFailures(uploaded[WORKFLOW] ?? "").join("\n")).toContain(
      "must not upload artifacts",
    );
    const report = sources[WORKFLOW]?.indexOf("  report:\n") ?? -1;
    expect(report).toBeGreaterThan(0);
    const source = sources[WORKFLOW] ?? "";
    const withCheckout = `${source.slice(0, report)}  report:\n    steps:\n      - uses: actions/checkout@0000000000000000000000000000000000000000\n${source.slice(report + "  report:\n".length)}`;
    expect(mainnetE2eWorkflowFailures(withCheckout)).toContain(
      "the hosted mainnet reporter must not check out or execute release-branch source",
    );
  });
});
