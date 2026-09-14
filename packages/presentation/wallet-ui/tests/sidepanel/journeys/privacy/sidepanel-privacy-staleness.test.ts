/**
 * A settled private operation invalidates the cached private-balance reading.
 * Registration and shielded balances are only re-read when the cached value is
 * null, and the controller otherwise resets solely on account/network/lock
 * changes — so without this a just-registered account keeps offering to
 * register, and a just-shielded amount stays invisible until the user switches
 * accounts or locks the wallet.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, preferences } from "@mc-wallet/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { createPrivacyController } from "../../../../src/sidepanel/journeys/privacy/privacy-controller";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import { bindPrivacy } from "../../../../src/sidepanel/journeys/privacy/privacy-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

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

const digest = `sha256:${"b".repeat(64)}`;
const preparation = {
  id: digest,
  kind: "register" as const,
  payloadDigest: digest,
  poolAddress: "0x123",
  route: "public-account" as const,
  summaries: ["Activate private balances"],
  symbol: "ETH",
  tokenId: preferences.tokens[0]?.id ?? "",
};

// The stale reading a successful registration must not leave behind.
const staleUnregistered = {
  accountId: account.id,
  balances: [],
  networkId: "SN_MAIN" as const,
  poolFeeFri: "0x1",
  relayConfigured: true,
  registration: "unregistered" as const,
  privateBalances: "ready" as const,
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (html: string): HTMLElement => {
  const app = document.createElement("main");
  app.innerHTML = html;
  document.body.append(app);
  return app;
};

describe("private-balance staleness after a settled operation", () => {
  test("a confirmed registration drops the cached reading so the next paint re-reads", async () => {
    let disclosure: PrivacyDisclosureState = {
      error: null,
      loading: false,
      value: staleUnregistered,
    };
    const app = mount('<button id="privacy-confirm" type="button"></button>');
    bindPrivacy({
      app,
      balances: () => [],
      disclosure: () => disclosure,
      generation: () => 0,
      journey: () => ({ preparation, stage: "activate-review", tokenId: preparation.tokenId }),
      navigate: () => undefined,
      paint: () => undefined,
      preferences: () => preferences,
      setDisclosure: (state) => {
        disclosure = state;
      },
      setJourney: () => undefined,
      status: () => status,
      wallet: {
        executePrivacyPreparation: async () => "0x777",
        // Discovery must not be re-triggered by this bind: the cached value is
        // still present when bindDisclosure runs.
        loadPrivacyState: async () => staleUnregistered,
      } as unknown as SidepanelWallet,
    });

    app.querySelector<HTMLButtonElement>("#privacy-confirm")?.click();
    await tick();

    // Cleared, not overwritten with a guessed "registered": the wallet re-reads
    // rather than asserting a state the indexer has not confirmed.
    expect(disclosure).toEqual({ error: null, loading: false, value: null });
  });

  test("the controller can invalidate the cache without disturbing a journey", () => {
    const controller = createPrivacyController({
      app: null,
      balances: () => ({ balances: [] }),
      navigate: () => undefined,
      paint: () => undefined,
      preferences: () => preferences,
      status: () => status,
      wallet: {} as unknown as SidepanelWallet,
    });

    expect(controller.disclosure().value).toBeNull();
    controller.invalidate();
    expect(controller.disclosure()).toEqual({ error: null, loading: false, value: null });
    // Unlike reset, invalidate leaves the journey alone — a private send settles
    // in the Send flow while a journey may legitimately be mid-flight.
    expect(controller.journey()).toEqual({ stage: "idle" });
  });
});
