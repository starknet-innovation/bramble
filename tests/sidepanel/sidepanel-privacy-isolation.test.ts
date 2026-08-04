/**
 * Slow privacy responses cannot repopulate a review or success state after the
 * selected account/network generation changes.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import type {
  PrivacyDisclosureState,
  PrivacyJourneyState,
} from "../../src/sidepanel/privacy-model";
import { bindPrivacy, type PrivacyUiDeps } from "../../src/sidepanel/privacy-ui";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";
import { registerDom, unregisterDom } from "../support/groups-harness";
import { account, preferences, secondAccount } from "../support/sidepanel-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const statusFor = (accountId: string): WalletStatus => ({
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: accountId,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
});

const digest = `sha256:${"a".repeat(64)}`;
const preparation = {
  amount: "1",
  id: digest,
  kind: "deposit" as const,
  payloadDigest: digest,
  poolAddress: "0x123",
  route: "public-account" as const,
  summaries: ["Shield 1 ETH"],
  symbol: "ETH",
  tokenId: preferences.tokens[0]?.id ?? "",
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (html: string): HTMLElement => {
  const app = document.createElement("main");
  app.innerHTML = html;
  document.body.append(app);
  return app;
};

describe("privacy UI async scope isolation", () => {
  test("uses the native checkbox change event to disable private balances", () => {
    let disclosure: PrivacyDisclosureState = {
      enabled: true,
      error: null,
      loading: false,
      value: null,
    };
    let paints = 0;
    const app = mount('<input checked data-privacy-toggle name="privateBalances" type="checkbox">');
    bindPrivacy({
      app,
      balances: () => [],
      disclosure: () => disclosure,
      generation: () => 0,
      journey: () => ({ stage: "idle" }),
      navigate: () => undefined,
      openToken: () => undefined,
      paint: () => {
        paints += 1;
      },
      preferences: () => preferences,
      setDisclosure: (state) => {
        disclosure = state;
      },
      setJourney: () => undefined,
      status: () => statusFor(account.id),
      wallet: {} as SidepanelWallet,
    });

    const toggle = app.querySelector<HTMLInputElement>("[data-privacy-toggle]");
    if (!toggle) {
      throw new Error("privacy checkbox missing");
    }
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(disclosure).toEqual({ enabled: false, error: null, loading: false, value: null });
    expect(paints).toBe(1);
  });

  test("loads private balances when the native checkbox is checked", async () => {
    const loaded = {
      accountId: account.id,
      balances: [],
      networkId: "SN_MAIN" as const,
      registration: "registered" as const,
    };
    let disclosure: PrivacyDisclosureState = {
      enabled: false,
      error: null,
      loading: false,
      value: null,
    };
    let paints = 0;
    const app = mount('<input data-privacy-toggle name="privateBalances" type="checkbox">');
    bindPrivacy({
      app,
      balances: () => [],
      disclosure: () => disclosure,
      generation: () => 0,
      journey: () => ({ stage: "idle" }),
      navigate: () => undefined,
      openToken: () => undefined,
      paint: () => {
        paints += 1;
      },
      preferences: () => preferences,
      setDisclosure: (state) => {
        disclosure = state;
      },
      setJourney: () => undefined,
      status: () => statusFor(account.id),
      wallet: {
        loadPrivacyState: async () => loaded,
      } as unknown as SidepanelWallet,
    });

    const toggle = app.querySelector<HTMLInputElement>("[data-privacy-toggle]");
    if (!toggle) {
      throw new Error("privacy checkbox missing");
    }
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    expect(disclosure).toEqual({ enabled: true, error: null, loading: false, value: loaded });
    expect(paints).toBe(2);
  });

  test("drops a registration preparation that resolves after account switch", async () => {
    const pending = deferred<typeof preparation>();
    let generation = 0;
    let status = statusFor(account.id);
    const journeys: PrivacyJourneyState[] = [];
    const app = mount(`<button data-privacy-open="${preparation.tokenId}">Go private</button>`);
    bindPrivacy({
      app,
      balances: () => [],
      disclosure: () => ({
        enabled: true,
        error: null,
        loading: false,
        value: {
          accountId: account.id,
          balances: [],
          networkId: "SN_MAIN",
          registration: "unregistered",
        },
      }),
      generation: () => generation,
      journey: () => ({ stage: "idle" }),
      navigate: () => undefined,
      openToken: () => undefined,
      paint: () => undefined,
      preferences: () => preferences,
      setDisclosure: () => undefined,
      setJourney: (journey) => journeys.push(journey),
      status: () => status,
      wallet: {
        preparePrivacyRegistration: () => pending.promise,
      } as unknown as SidepanelWallet,
    });

    app.querySelector<HTMLButtonElement>("[data-privacy-open]")?.click();
    generation += 1;
    status = statusFor(secondAccount.id);
    pending.resolve(preparation);
    await tick();

    expect(journeys).toEqual([]);
  });

  test("drops a deposit review that resolves after network generation reset", async () => {
    const pending = deferred<typeof preparation>();
    let generation = 0;
    const journeys: PrivacyJourneyState[] = [];
    const app = mount(
      `<form id="privacy-deposit-form"><input name="amount" value="1"><button type="submit">Review</button></form><p id="privacy-compose-result"></p>`,
    );
    const deps = {
      app,
      balances: () => [],
      disclosure: () => ({ enabled: true, error: null, loading: false, value: null }),
      generation: () => generation,
      journey: () => ({ stage: "compose", tokenId: preparation.tokenId }) as PrivacyJourneyState,
      navigate: () => undefined,
      openToken: () => undefined,
      paint: () => undefined,
      preferences: () => preferences,
      setDisclosure: () => undefined,
      setJourney: (journey: PrivacyJourneyState) => journeys.push(journey),
      status: () => statusFor(account.id),
      wallet: {
        preparePrivacyDeposit: () => pending.promise,
      } as unknown as SidepanelWallet,
    } satisfies PrivacyUiDeps;
    bindPrivacy(deps);

    app.querySelector<HTMLFormElement>("form")?.requestSubmit();
    generation += 1;
    pending.resolve(preparation);
    await tick();

    expect(journeys).toEqual([]);
  });

  test("drops execution success after the reviewed account scope is reset", async () => {
    const pending = deferred<string>();
    let generation = 0;
    const journeys: PrivacyJourneyState[] = [];
    const app = mount(`<button id="privacy-confirm">Confirm</button>`);
    bindPrivacy({
      app,
      balances: () => [],
      disclosure: () => ({ enabled: true, error: null, loading: false, value: null }),
      generation: () => generation,
      journey: () => ({
        preparation,
        stage: "deposit-review",
        tokenId: preparation.tokenId,
      }),
      navigate: () => undefined,
      openToken: () => undefined,
      paint: () => undefined,
      preferences: () => preferences,
      setDisclosure: () => undefined,
      setJourney: (journey) => journeys.push(journey),
      status: () => statusFor(account.id),
      wallet: {
        executePrivacyPreparation: () => pending.promise,
      } as unknown as SidepanelWallet,
    });

    app.querySelector<HTMLButtonElement>("#privacy-confirm")?.click();
    generation += 1;
    pending.resolve("0x789");
    await tick();

    expect(journeys.map((journey) => journey.stage)).toEqual(["working"]);
  });
});
