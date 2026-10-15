/**
 * The Shadow accounts screen (issue 443, PR 5): it says why balances wait for
 * a tap, lists the vault's records without reading the network, reads one
 * scope only when asked, and reviews a sweep before confirming it. The client
 * refuses malformed background answers.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PrivacyPreparation } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import {
  SHADOW_ACCOUNTS_EMPTY,
  SHADOW_ACCOUNTS_READ_REASON,
  SHADOW_ACCOUNTS_SWEEP_SENT,
} from "../../../../src/sidepanel/journeys/privacy/shadow-accounts-copy";
import { createShadowAccountsRuntimeClient } from "../../../../src/sidepanel/journeys/privacy/shadow-accounts-runtime";
import { bindShadowAccounts } from "../../../../src/sidepanel/journeys/privacy/shadow-accounts-ui";
import { shadowAccountsFlow } from "../../../../src/sidepanel/journeys/privacy/shadow-accounts-view";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const status = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Sepolia",
  networkId: "SN_SEPOLIA",
  networks: [{ id: "SN_SEPOLIA", name: "Starknet Sepolia" }],
  ready: true,
} as const;

const scope = {
  anonymizer: "0x4f3",
  current: true,
  label: "Market",
  nonces: ["0x0", "0x1"],
  origin: "https://app.example",
};
const account = {
  address: "0x5ad01",
  balances: [
    {
      balance: "0x1bc16d674ec80000",
      formatted: "2",
      symbol: "STRK",
      tokenId: "SN_SEPOLIA:STRK:0x4718",
    },
  ],
  deployed: false,
  nonce: "0x1",
  recorded: true,
};
const preparation: PrivacyPreparation = {
  id: `sha256:${"a".repeat(64)}`,
  kind: "shadow-sweep",
  payloadDigest: `sha256:${"a".repeat(64)}`,
  poolAddress: "0x1",
  recipient: "0x2",
  relayFee: { amount: "0x1", recipient: "0x3", token: "0x4" },
  route: "private-relay",
  summaries: ["Sweep your shadow account #1 for https://app.example", "Private relay fee 0.1 STRK"],
  symbol: "STRK",
  tokenId: "SN_SEPOLIA:STRK:0x4718",
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const mount = () => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.innerHTML = shadowAccountsFlow(status as never);
  document.body.append(app);
  return app;
};

describe("shadow accounts screen", () => {
  test("states why balances wait, and reads nothing from the network on open", async () => {
    const calls: string[] = [];
    const app = mount();
    expect(app.textContent).toContain(SHADOW_ACCOUNTS_READ_REASON);
    bindShadowAccounts({
      app,
      wallet: {
        async executePrivacyPreparation() {
          calls.push("execute");
          return "0x5ee";
        },
        async loadShadowAccountBalances() {
          calls.push("balances");
          return { accounts: [account], unlisted: [] };
        },
        async loadShadowAccounts() {
          calls.push("list");
          return [scope];
        },
        async prepareShadowSweep() {
          calls.push("prepare");
          return preparation;
        },
      },
    });
    await settle();
    expect(calls).toEqual(["list"]);
    expect(app.textContent).toContain("https://app.example");
    expect(app.textContent).toContain("Market");

    const button = (label: string) =>
      [...app.querySelectorAll("button")].find((node) => node.textContent === label);
    button("Check balances")?.click();
    await settle();
    expect(calls).toEqual(["list", "balances"]);
    expect(app.textContent).toContain("#1");
    expect(app.textContent).toContain("2 STRK");
    expect(app.textContent).toContain("Not deployed");

    button("Sweep")?.click();
    await settle();
    expect(calls).toEqual(["list", "balances", "prepare"]);
    // The review is shown before anything is confirmed.
    expect(app.textContent).toContain("Sweep your shadow account #1 for https://app.example");
    expect(app.textContent).toContain("Private relay fee 0.1 STRK");

    button("Confirm sweep")?.click();
    await settle();
    expect(calls).toEqual(["list", "balances", "prepare", "execute"]);
    expect(app.textContent).toContain(SHADOW_ACCOUNTS_SWEEP_SENT);
  });

  test("an empty record list and a scope under another anonymizer offer no network read", async () => {
    for (const [scopes, expected] of [
      [[], SHADOW_ACCOUNTS_EMPTY],
      [[{ ...scope, current: false }], "Recorded under another anonymizer, 0x4f3."],
    ] as const) {
      const app = mount();
      bindShadowAccounts({
        app,
        wallet: {
          executePrivacyPreparation: async () => "",
          loadShadowAccountBalances: async () => ({ accounts: [], unlisted: [] }),
          loadShadowAccounts: async () => scopes,
          prepareShadowSweep: async () => preparation,
        },
      });
      await settle();
      expect(app.textContent).toContain(expected);
      expect([...app.querySelectorAll("button")].map((node) => node.textContent)).not.toContain(
        "Check balances",
      );
    }
  });

  test("the client refuses malformed answers", async () => {
    const client = (response: unknown) => createShadowAccountsRuntimeClient(async () => response);
    await expect(
      client({ ok: true, strk20ShadowAccounts: { scopes: [scope] } }).loadShadowAccounts(),
    ).resolves.toEqual([scope]);
    for (const bad of [
      { ok: true, strk20ShadowAccounts: { scopes: [{ ...scope, origin: "http://app.example" }] } },
      { ok: true, strk20ShadowAccounts: { scopes: [{ ...scope, extra: 1 }] } },
      { ok: true, strk20ShadowAccounts: { scopes: [{ ...scope, nonces: ["1"] }] } },
      { ok: true, strk20ShadowAccounts: { extra: [], scopes: [] } },
    ]) {
      await expect(client(bad).loadShadowAccounts()).rejects.toThrow();
    }
    await expect(
      client({
        ok: true,
        strk20ShadowAccountBalances: { accounts: [{ ...account, address: "0x0" }], unlisted: [] },
      }).loadShadowAccountBalances("https://app.example", "Market"),
    ).rejects.toThrow();
    await expect(
      client({
        ok: true,
        strk20Preparation: { ...preparation, amount: "1" },
      }).prepareShadowSweep("https://app.example", "Market", "0x1"),
    ).rejects.toThrow();
    await expect(
      client({ ok: true, strk20Preparation: preparation }).prepareShadowSweep(
        "https://app.example",
        "Market",
        "0x1",
      ),
    ).resolves.toEqual(preparation);
  });
});
