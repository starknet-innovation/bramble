/**
 * MCW-V09-129 settings surface: the advanced-endpoints screen must show the
 * explorer-fallback state the background would actually apply, and submitting
 * the control must carry the checkbox's literal state to the privileged
 * message — not a guess, and not a value inverted somewhere in the binding.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { bindEndpointSettings } from "../../../../src/sidepanel/journeys/settings/endpoint-ui";
import { advancedNetworkFlow } from "../../../../src/sidepanel/journeys/settings/network-views";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const MY_NODE = "https://my-node.example/rpc";
const MY_EXPLORER = "https://explorer.example/v1";

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

const preferences = (overrides: Partial<WalletPreferences>): WalletPreferences => ({
  ...defaultWalletPreferences(),
  ...overrides,
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Only the explorer-fallback disclosure, so a summary that reads "Off" for the
// unrelated privacy or indexer integrations can never stand in for this one.
const laneSection = (prefs: WalletPreferences | null): string => {
  const html = advancedNetworkFlow(status, prefs);
  const start = html.indexOf('data-disclosure="explorer-fallback"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</details>", start));
};

const screen = (checked: boolean, apiUrl = ""): HTMLElement => {
  const app = document.createElement("div");
  app.innerHTML = `<form id="explorer-fallback-form">
      <input name="apiUrl" value="${apiUrl}" />
      <input name="explorerFallback" type="checkbox"${checked ? " checked" : ""} />
      <button type="submit">Save</button>
    </form><p id="explorer-fallback-result"></p>`;
  document.body.append(app);
  return app;
};

const walletStub = (calls: Array<readonly [string, boolean, string]>, fail = false) =>
  ({
    loadStatus: async () => status,
    setExplorerFallback: async (networkId: string, enabled: boolean, apiUrl: string) => {
      calls.push([networkId, enabled, apiUrl]);
      if (fail) {
        throw new Error("Couldn't load your settings. Try again.");
      }
    },
  }) as unknown as SidepanelWallet;

describe("advanced endpoints explorer-fallback control", () => {
  test("clearly discloses that product analytics are on by default", () => {
    const html = advancedNetworkFlow(status, null);
    const start = html.indexOf('data-disclosure="product-analytics"');
    expect(start).toBeGreaterThan(-1);
    const section = html.slice(start, html.indexOf("</details>", start));

    expect(section).toContain("Product analytics");
    expect(section).toContain("On");
    // The default matters and stays; "turn off anytime" was true of every
    // checkbox on the screen and told the reader nothing.
    expect(section).toContain("on by default");
    expect(section).not.toContain("turn off anytime");
    expect(section).toContain('id="product-analytics"');
    expect(section).toContain("checked");
  });

  test("shows custom coordination relay and diagnostics in infrastructure settings", () => {
    const relayUrl = "wss://relay.team.example";
    const html = advancedNetworkFlow(
      status,
      preferences({
        nostrRelayUrl: relayUrl,
        productAnalytics: true,
        reliabilityDiagnostics: true,
      }),
    );

    expect(html).toContain('data-disclosure="nostr-relay"');
    expect(html).toContain(`value="${relayUrl}"`);
    expect(html).toContain('data-disclosure="product-analytics"');
    expect(html).toContain('id="product-analytics"');
    expect(html).toContain('data-disclosure="reliability-diagnostics"');
    expect(html).toContain('id="reliability-diagnostics"');
  });

  test("shows the lane as allowed for a user on the built-in endpoints", () => {
    const section = laneSection(preferences({}));

    expect(section).toContain("Explorer data");
    expect(section).toContain("Default · Allowed");
    expect(section).toContain('name="explorerFallback" type="checkbox" checked');
  });

  test("shows the lane off for a user who configured their own RPC", () => {
    const section = laneSection(preferences({ rpcOverrides: { SN_MAIN: MY_NODE } }));

    expect(section).toContain("Default · Off");
    expect(section).toContain('name="explorerFallback" type="checkbox" /');
    expect(section).not.toContain("checked");
  });

  test("shows an explicit opt-in even with an override configured", () => {
    const section = laneSection(
      preferences({ explorerFallback: { SN_MAIN: true }, rpcOverrides: { SN_MAIN: MY_NODE } }),
    );

    expect(section).toContain("Default · Allowed");
    expect(section).toContain('name="explorerFallback" type="checkbox" checked');
  });

  test("shows the selected explorer API beside its disclosure choice", () => {
    const section = laneSection(
      preferences({
        explorerApiUrls: { SN_MAIN: MY_EXPLORER },
        explorerFallback: { SN_MAIN: true },
      }),
    );

    expect(section).toContain("Custom · Allowed");
    expect(section).toContain(`value="${MY_EXPLORER}"`);
  });

  test("renders as off when preferences could not be loaded", () => {
    const section = laneSection(null);

    expect(section).toContain("Default · Off");
    expect(section).not.toContain("checked");
  });

  test("submits the unchecked box as an explicit refusal", async () => {
    const app = screen(false);
    const calls: Array<readonly [string, boolean, string]> = [];
    let renders = 0;
    bindEndpointSettings({
      app,
      networkId: () => "SN_MAIN",
      render: async () => {
        renders += 1;
      },
      wallet: walletStub(calls),
    });

    app.querySelector<HTMLFormElement>("#explorer-fallback-form")?.requestSubmit();
    await tick();

    expect(calls).toEqual([["SN_MAIN", false, ""]]);
    expect(renders).toBe(1);
  });

  test("submits the checked box as an explicit opt-in", async () => {
    const app = screen(true);
    const calls: Array<readonly [string, boolean, string]> = [];
    bindEndpointSettings({
      app,
      networkId: () => "SN_MAIN",
      render: async () => undefined,
      wallet: walletStub(calls),
    });

    app.querySelector<HTMLFormElement>("#explorer-fallback-form")?.requestSubmit();
    await tick();

    expect(calls).toEqual([["SN_MAIN", true, ""]]);
  });

  test("surfaces a failed save instead of implying the choice was recorded", async () => {
    const app = screen(true);
    const calls: Array<readonly [string, boolean, string]> = [];
    bindEndpointSettings({
      app,
      networkId: () => "SN_MAIN",
      render: async () => undefined,
      wallet: walletStub(calls, true),
    });

    app.querySelector<HTMLFormElement>("#explorer-fallback-form")?.requestSubmit();
    await tick();

    expect(app.querySelector("#explorer-fallback-result")?.textContent).toBe(
      "Couldn't load your settings. Try again.",
    );
  });

  test("requests only the custom explorer origin before saving it", async () => {
    const app = screen(true, MY_EXPLORER);
    const calls: Array<readonly [string, boolean, string]> = [];
    const origins: string[][] = [];
    bindEndpointSettings({
      app,
      networkId: () => "SN_MAIN",
      permissions: {
        request: async ({ origins: requested }) => {
          origins.push(requested);
          return true;
        },
      },
      render: async () => undefined,
      wallet: walletStub(calls),
    });

    app.querySelector<HTMLFormElement>("#explorer-fallback-form")?.requestSubmit();
    await tick();

    expect(origins).toEqual([["https://explorer.example/*"]]);
    expect(calls).toEqual([["SN_MAIN", true, MY_EXPLORER]]);
  });

  test("does not store an endpoint when Chrome denies its host permission", async () => {
    const app = screen(true, MY_EXPLORER);
    const calls: Array<readonly [string, boolean, string]> = [];
    bindEndpointSettings({
      app,
      networkId: () => "SN_MAIN",
      permissions: { request: async () => false },
      render: async () => undefined,
      wallet: walletStub(calls),
    });

    app.querySelector<HTMLFormElement>("#explorer-fallback-form")?.requestSubmit();
    await tick();

    expect(calls).toEqual([]);
    expect(document.querySelector(".toast.error .toast-text")?.textContent).toContain(
      "did not grant access",
    );
  });

  test("does not store a custom HTTP endpoint without Chrome permission controls", async () => {
    const app = screen(true, MY_EXPLORER);
    const calls: Array<readonly [string, boolean, string]> = [];
    bindEndpointSettings({
      app,
      networkId: () => "SN_MAIN",
      render: async () => undefined,
      wallet: walletStub(calls),
    });

    app.querySelector<HTMLFormElement>("#explorer-fallback-form")?.requestSubmit();
    await tick();

    expect(calls).toEqual([]);
    expect(document.querySelector(".toast.error .toast-text")?.textContent).toContain(
      "permission controls are unavailable",
    );
  });

  test("submits a custom coordination relay through its dedicated preference", async () => {
    const app = document.createElement("div");
    app.innerHTML = `<form id="nostr-relay-form">
      <input name="relayUrl" value=" wss://relay.team.example " />
      <button type="submit">Save</button>
    </form><p id="nostr-relay-result"></p>`;
    document.body.append(app);
    const saved: string[] = [];
    bindEndpointSettings({
      app,
      networkId: () => "SN_MAIN",
      render: async () => undefined,
      wallet: {
        loadStatus: async () => status,
        setNostrRelayUrl: async (relayUrl: string) => {
          saved.push(relayUrl);
        },
      } as unknown as SidepanelWallet,
    });

    app.querySelector<HTMLFormElement>("#nostr-relay-form")?.requestSubmit();
    await tick();

    expect(saved).toEqual(["wss://relay.team.example"]);
  });
});
