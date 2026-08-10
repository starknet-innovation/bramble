/**
 * The Shield and Unshield entry points on an asset.
 *
 * Both are sends between one account's two balances, so neither opens a journey
 * of its own: they open Send already configured, with the active account on both
 * ends and the buckets that name the direction. The direction lives entirely in
 * that configuration, so these pin which bucket each button asks for.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { bindPrivacy } from "../../src/sidepanel/privacy-ui";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";
import type { SendIntent } from "../../src/sidepanel/send-model";
import { registerDom, unregisterDom } from "../support/groups-harness";
import { account, preferences } from "../support/sidepanel-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const TOKEN_ID = preferences.tokens[0]?.id ?? "SN_MAIN:ETH:0x1";

const bindWith = (html: string): { intents: readonly SendIntent[]; app: HTMLElement } => {
  const intents: SendIntent[] = [];
  const app = document.createElement("main");
  app.innerHTML = html;
  document.body.append(app);
  bindPrivacy({
    app,
    balances: () => [],
    disclosure: () => ({
      error: null,
      loading: false,
      value: {
        accountId: account.id,
        balances: [],
        networkId: "SN_MAIN",
        poolFeeFri: "0x1",
        relayConfigured: true,
        registration: "registered",
        privateBalances: "ready",
      },
    }),
    generation: () => 0,
    journey: () => ({ stage: "idle" }),
    navigate: () => undefined,
    openSend: (intent) => {
      intents.push(intent);
    },
    paint: () => undefined,
    preferences: () => preferences,
    setDisclosure: () => undefined,
    setJourney: () => undefined,
    status: () => status,
    wallet: { loadPrivacyState: async () => ({}) } as unknown as SidepanelWallet,
  });
  return { app, intents };
};

const click = (app: HTMLElement, selector: string): void => {
  app.querySelector<HTMLButtonElement>(selector)?.dispatchEvent(new Event("click"));
};

describe("shield and unshield shortcuts", () => {
  test("shield opens Send from the public balance into the private one", () => {
    const { app, intents } = bindWith(`<button data-send-shield="${TOKEN_ID}">Shield</button>`);

    click(app, "[data-send-shield]");

    expect(intents).toEqual([
      {
        accountId: account.id,
        destination: "private",
        networkId: "SN_MAIN",
        recipient: account.address,
        recipientLabel: expect.any(String) as unknown as string,
        source: "public",
        tokenId: TOKEN_ID,
      },
    ]);
  });

  test("unshield is the same send with the buckets swapped", () => {
    const { app, intents } = bindWith(`<button data-send-unshield="${TOKEN_ID}">Unshield</button>`);

    click(app, "[data-send-unshield]");

    expect(intents[0]?.destination).toBe("public");
    expect(intents[0]?.source).toBe("private");
    // Both ends are the active account: this moves value between its own balances.
    expect(intents[0]?.recipient).toBe(account.address);
  });

  test("a button with no token opens nothing rather than an unconfigured send", () => {
    const { app, intents } = bindWith(`<button data-send-shield="">Shield</button>`);

    click(app, "[data-send-shield]");

    expect(intents).toEqual([]);
  });
});
