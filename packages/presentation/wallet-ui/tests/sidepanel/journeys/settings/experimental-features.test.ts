/**
 * Settings > Experimental features: the screen renders only what the
 * background answered (escaping flag keys), disables a feature Bramble turned
 * off, sends the user's literal choice, and the client refuses malformed
 * replies instead of rendering them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  createExperimentalFeaturesClient,
  type ExperimentalFeatures,
  type ExperimentalFeaturesState,
} from "../../../../src/sidepanel/journeys/settings/experimental-features-runtime";
import {
  bindExperimentalFeatures,
  experimentalFeaturesFlow,
} from "../../../../src/sidepanel/journeys/settings/experimental-features-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const FEATURES: ExperimentalFeatures = {
  flags: { "beta.screen": true, "old.tool": false, "swap.enabled": true },
  killed: ["old.tool"],
  overridable: ["beta.screen", "old.tool"],
  overridden: ["beta.screen"],
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (state: ExperimentalFeaturesState): HTMLElement => {
  const app = document.createElement("div");
  app.innerHTML = experimentalFeaturesFlow(status, state);
  document.body.append(app);
  return app;
};

describe("experimental features screen", () => {
  test("lists only overridable features with their state", () => {
    const html = experimentalFeaturesFlow(status, FEATURES);
    expect(html).toContain("beta.screen");
    expect(html).toContain("On · your choice");
    expect(html).toContain("Off · turned off by Bramble");
    expect(html).not.toContain("swap.enabled");
    expect(html).toContain("Reset all");
  });

  test("a feature Bramble turned off cannot be chosen", () => {
    const app = mount(FEATURES);
    const controls = app.querySelectorAll<HTMLButtonElement>('[data-flag-key="old.tool"]');
    expect(controls).toHaveLength(3);
    for (const control of controls) expect(control.disabled).toBe(true);
  });

  test("escapes flag keys", () => {
    const html = experimentalFeaturesFlow(status, {
      flags: { "<b>x</b>": true },
      killed: [],
      overridable: ["<b>x</b>"],
      overridden: [],
    });
    expect(html).not.toContain("<b>x</b>");
  });

  test("loading, failure and empty states never show controls", () => {
    expect(experimentalFeaturesFlow(status, "loading")).not.toContain("data-flag-choice");
    // emptyState escapes the apostrophe.
    expect(experimentalFeaturesFlow(status, "error")).toContain("load experimental features.");
    const empty = experimentalFeaturesFlow(status, {
      flags: {},
      killed: [],
      overridable: [],
      overridden: [],
    });
    expect(empty).toContain("This version has no features you can change.");
    expect(empty).not.toContain("Reset all");
  });

  test("sends the chosen value and stores the background's answer", async () => {
    const calls: Array<readonly [string, boolean | null]> = [];
    const states: ExperimentalFeaturesState[] = [];
    const app = mount(FEATURES);
    bindExperimentalFeatures({
      app,
      render: async () => undefined,
      setState: (state) => states.push(state),
      status: () => status,
      wallet: {
        resetExperimentalFeatures: async () => ({ ...FEATURES, overridden: [] }),
        setExperimentalFeature: async (key: string, value: boolean | null) => {
          calls.push([key, value]);
          return FEATURES;
        },
      } as unknown as SidepanelWallet,
    });
    app
      .querySelector<HTMLButtonElement>('[data-flag-key="beta.screen"][data-flag-choice="off"]')
      ?.click();
    app
      .querySelector<HTMLButtonElement>('[data-flag-key="beta.screen"][data-flag-choice="default"]')
      ?.click();
    // The pressed choice is already in effect, so it sends nothing.
    app
      .querySelector<HTMLButtonElement>('[data-flag-key="beta.screen"][data-flag-choice="on"]')
      ?.click();
    app.querySelector<HTMLButtonElement>("#experimental-features-reset")?.click();
    await tick();
    expect(calls).toEqual([
      ["beta.screen", false],
      ["beta.screen", null],
    ]);
    expect(states).toHaveLength(3);
  });
});

describe("experimental features client", () => {
  const reply = { ...FEATURES, ok: true, sequence: null, source: "bundled" };
  const clientWith = (response: unknown, sent: unknown[] = []) =>
    createExperimentalFeaturesClient(async (message) => {
      sent.push(message);
      return response;
    });

  test("accepts a well-formed reply and sends the exact override message", async () => {
    const sent: unknown[] = [];
    const client = clientWith(reply, sent);
    expect(await client.loadExperimentalFeatures()).toEqual(FEATURES);
    await client.setExperimentalFeature("beta.screen", null);
    await client.resetExperimentalFeatures();
    expect(sent).toEqual([
      { type: "wallet.featureFlags" },
      { key: "beta.screen", type: "wallet.setFeatureFlagOverride", value: null },
      { type: "wallet.clearFeatureFlagOverrides" },
    ]);
  });

  test.each([
    ["an extra field", { ...reply, bucket: 7 }],
    ["a non-boolean value", { ...reply, flags: { ...FEATURES.flags, "beta.screen": "on" } }],
    ["a listed key with no value", { ...reply, overridden: ["missing"] }],
    ["a duplicate key", { ...reply, killed: ["old.tool", "old.tool"] }],
    ["an error", { error: "wallet locked" }],
  ])("refuses a reply with %s", async (_name, response) => {
    await expect(clientWith(response).loadExperimentalFeatures()).rejects.toThrow();
  });
});
