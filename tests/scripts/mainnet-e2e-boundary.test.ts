/**
 * Only `mainnet-e2e.yml` may reach the mainnet E2E environments and secrets:
 * any other workflow that asks for them, or hides how it would, fails the
 * workflow security gate.
 */
import { describe, expect, test } from "bun:test";
import { mainnetE2eBoundaryFailures } from "../../scripts/mainnet-e2e-boundary";
import { mainnetE2eWorkflowFailures } from "../../scripts/mainnet-e2e-workflow-policy";
import { readWorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";
import { BOUNDARY_CASES, BOUNDARY_CONTROLS } from "./mainnet-e2e-boundary-mutations";

describe("mainnet E2E cross-workflow boundary", () => {
  test("the repository workflows stay clear of the boundary", async () => {
    const sources = await readWorkflowSources();
    for (const [name, source] of Object.entries(sources)) {
      expect(mainnetE2eBoundaryFailures(name, source)).toEqual([]);
    }
  });

  test("refuses another workflow that reaches the mainnet environments or secrets", async () => {
    const sources = await readWorkflowSources();
    for (const { label, files, failure } of BOUNDARY_CASES) {
      const failures = workflowSecurityPolicyFailures({ ...sources, ...files });
      if (!failures.includes(failure)) throw new Error(`accepted ${label}: ${failures.join("\n")}`);
    }
  });

  test("leaves unrelated environments and secrets alone", async () => {
    for (const { label, files } of BOUNDARY_CONTROLS) {
      for (const [name, source] of Object.entries(files)) {
        const failures = mainnetE2eBoundaryFailures(name, source);
        if (failures.length > 0) throw new Error(`rejected ${label}: ${failures.join("\n")}`);
      }
    }
  });

  test("refuses secrets: inherit on a reviewed reusable call", async () => {
    const sources = await readWorkflowSources();
    const release = sources["release.yml"] ?? "";
    const call = "    uses: ./.github/workflows/release-build.yml\n";
    expect(release).toContain(call);
    const inherited = release.replace(call, `${call}    secrets: inherit\n`);
    expect(mainnetE2eBoundaryFailures("release.yml", inherited)).toContain(
      ".github/workflows/release.yml job build-release must not pass secrets: inherit",
    );
  });

  test("mainnet-e2e.yml cannot become a reusable workflow", async () => {
    const source = (await readWorkflowSources())["mainnet-e2e.yml"] ?? "";
    const callable = source.replace(
      "  workflow_dispatch:\n",
      "  workflow_call:\n  workflow_dispatch:\n",
    );
    expect(mainnetE2eWorkflowFailures(callable)).toContain(
      ".github/workflows/mainnet-e2e.yml must not trigger on workflow_call:",
    );
  });
});
