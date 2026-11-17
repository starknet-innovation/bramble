/**
 * The live-mainnet CI opt-in. Local runs stay local. Generic CI stays refused.
 * Only the reviewed Mainnet E2E workflow on main is allowed, and refusal text
 * never includes a supplied key.
 */
import { describe, expect, test } from "bun:test";
import {
  assertLiveMainnetAllowed,
  decideMainnetCi,
  MAINNET_E2E_CI_OPT_IN,
  MAINNET_E2E_ENVIRONMENT,
  MAINNET_E2E_REF,
  MAINNET_E2E_REPOSITORY,
  MAINNET_E2E_WORKFLOW_NAME,
  mainnetE2eWorkflowRef,
  strk20LifecycleExcluded,
} from "../../scripts/mainnet-e2e-guard";

const allowed = (event = "schedule"): Record<string, string> => ({
  BRAMBLE_MAINNET_E2E_CI: MAINNET_E2E_CI_OPT_IN,
  BRAMBLE_MAINNET_E2E_ENVIRONMENT: MAINNET_E2E_ENVIRONMENT,
  CI: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: event,
  GITHUB_REF: MAINNET_E2E_REF,
  GITHUB_REPOSITORY: MAINNET_E2E_REPOSITORY,
  GITHUB_WORKFLOW: MAINNET_E2E_WORKFLOW_NAME,
  GITHUB_WORKFLOW_REF: mainnetE2eWorkflowRef(),
});

describe("mainnet CI guard", () => {
  test("leaves a local run unchanged when CI is unset", () => {
    expect(decideMainnetCi({})).toEqual({ kind: "local" });
    expect(decideMainnetCi({ BRAMBLE_MAINNET_E2E_CI: "1" })).toEqual({ kind: "local" });
    expect(decideMainnetCi({ CI: "" })).toEqual({ kind: "local" });
    expect(strk20LifecycleExcluded({})).toBe(false);
  });

  test("refuses generic CI and does not echo a key", () => {
    const env = {
      ...allowed(),
      BRAMBLE_MAINNET_E2E_CI: "true",
      BRAMBLE_STRK20_E2E_PRIVATE_KEY: "0xsecret",
    };
    const decision = decideMainnetCi(env);
    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") return;
    expect(decision.reason).toContain("local-only");
    expect(decision.reason).not.toContain("0xsecret");
    expect(() => assertLiveMainnetAllowed(env)).toThrow("local-only");
  });

  test("allows schedule and workflow_dispatch from the workflow file on main", () => {
    expect(decideMainnetCi(allowed())).toEqual({ kind: "allowed" });
    expect(decideMainnetCi(allowed("workflow_dispatch"))).toEqual({ kind: "allowed" });
    expect(assertLiveMainnetAllowed(allowed()).kind).toBe("allowed");
  });

  test("refuses an opt-in that is not this repository's Mainnet E2E workflow", () => {
    expect(decideMainnetCi({ ...allowed(), GITHUB_ACTIONS: "false" }).kind).toBe("refused");
    expect(decideMainnetCi({ ...allowed(), GITHUB_REPOSITORY: "example/bramble" }).kind).toBe(
      "refused",
    );
    expect(decideMainnetCi({ ...allowed(), GITHUB_WORKFLOW: "Nightly" }).kind).toBe("refused");
    expect(decideMainnetCi({ ...allowed(), GITHUB_WORKFLOW_REF: "elsewhere" }).kind).toBe(
      "refused",
    );
    expect(decideMainnetCi({ ...allowed(), GITHUB_REF: "refs/heads/release/v0.10.9" }).kind).toBe(
      "refused",
    );
    expect(decideMainnetCi({ ...allowed(), GITHUB_EVENT_NAME: "pull_request" }).kind).toBe(
      "refused",
    );
    expect(
      decideMainnetCi({ ...allowed(), BRAMBLE_MAINNET_E2E_ENVIRONMENT: "production" }).kind,
    ).toBe("refused");
  });

  test("keeps the STRK20 lifecycle out of the standard CI opt-in", () => {
    expect(strk20LifecycleExcluded(allowed())).toBe(true);
    expect(strk20LifecycleExcluded({ ...allowed(), BRAMBLE_STRK20_E2E_CI: "1" })).toBe(false);
    expect(strk20LifecycleExcluded({ CI: "true" })).toBe(false);
  });

  test("the gasless entrypoint and the Playwright config use the guard", async () => {
    const gasless = await Bun.file("scripts/gasless-mainnet-e2e.ts").text();
    const config = await Bun.file("playwright.mainnet.config.ts").text();
    const setup = await Bun.file("tests/mainnet/global-setup.ts").text();
    expect(gasless).toContain("assertLiveMainnetAllowed(process.env)");
    expect(config).toContain("strk20LifecycleExcluded");
    expect(setup).toContain("strk20LifecycleExcluded");
  });
});
