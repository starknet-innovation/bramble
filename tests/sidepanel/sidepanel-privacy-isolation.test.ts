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
  id: digest,
  kind: "register" as const,
  payloadDigest: digest,
  poolAddress: "0x123",
  route: "public-account" as const,
  summaries: ["Register viewing-key commitment"],
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
  test("starts shielded-balance discovery automatically for the unlocked account", async () => {
    const loaded = {
      accountId: account.id,
      balances: [],
      networkId: "SN_MAIN" as const,
      registration: "registered" as const,
    };
    let disclosure: PrivacyDisclosureState = { error: null, loading: false, value: null };
    let paints = 0;
    const app = mount("<div></div>");
    bindPrivacy({
      app,
      balances: () => [],
      disclosure: () => disclosure,
      generation: () => 0,
      journey: () => ({ stage: "idle" }),
      navigate: () => undefined,
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
    await tick();

    expect(disclosure).toEqual({ error: null, loading: false, value: loaded });
    expect(paints).toBe(2);
  });

  test("never starts discovery while locked, already loading, or after an error", () => {
    let loads = 0;
    const wallet = {
      loadPrivacyState: async () => {
        loads += 1;
        throw new Error("must not be called");
      },
    } as unknown as SidepanelWallet;
    const bindWith = (status: WalletStatus, disclosure: PrivacyDisclosureState): void => {
      bindPrivacy({
        app: mount("<div></div>"),
        balances: () => [],
        disclosure: () => disclosure,
        generation: () => 0,
        journey: () => ({ stage: "idle" }),
        navigate: () => undefined,
        paint: () => undefined,
        preferences: () => preferences,
        setDisclosure: () => undefined,
        setJourney: () => undefined,
        status: () => status,
        wallet,
      });
    };

    bindWith(
      { ...statusFor(account.id), locked: true },
      { error: null, loading: false, value: null },
    );
    bindWith(statusFor(account.id), { error: null, loading: true, value: null });
    bindWith(statusFor(account.id), { error: "prover offline", loading: false, value: null });

    expect(loads).toBe(0);
  });

  test("drops a slow discovery that resolves after the account scope changes", async () => {
    const pending = deferred<{
      readonly accountId: string;
      readonly balances: readonly [];
      readonly networkId: "SN_MAIN";
      readonly registration: "registered";
    }>();
    let disclosure: PrivacyDisclosureState = { error: null, loading: false, value: null };
    let generation = 0;
    let status = statusFor(account.id);
    let paints = 0;
    bindPrivacy({
      app: mount("<div></div>"),
      balances: () => [],
      disclosure: () => disclosure,
      generation: () => generation,
      journey: () => ({ stage: "idle" }),
      navigate: () => undefined,
      paint: () => {
        paints += 1;
      },
      preferences: () => preferences,
      setDisclosure: (state) => {
        disclosure = state;
      },
      setJourney: () => undefined,
      status: () => status,
      wallet: {
        loadPrivacyState: () => pending.promise,
      } as unknown as SidepanelWallet,
    });

    generation += 1;
    status = statusFor(secondAccount.id);
    pending.resolve({
      accountId: account.id,
      balances: [],
      networkId: "SN_MAIN",
      registration: "registered",
    });
    await tick();

    expect(disclosure.value).toBeNull();
    expect(paints).toBe(1);
  });

  test("never prepares a second registration while the first one is unindexed", async () => {
    let registration: "pending" | "registered" = "pending";
    let prepares = 0;
    const app = mount(`<button data-privacy-open="${preparation.tokenId}">Go private</button>`);
    const deps = {
      app,
      balances: () => [],
      disclosure: () => ({
        error: null,
        loading: false,
        value: {
          accountId: account.id,
          balances: [],
          networkId: "SN_MAIN",
          registration,
        },
      }),
      generation: () => 0,
      journey: () => ({ stage: "idle" }) as PrivacyJourneyState,
      navigate: () => undefined,
      paint: () => undefined,
      preferences: () => preferences,
      setDisclosure: () => undefined,
      setJourney: () => undefined,
      status: () => statusFor(account.id),
      wallet: {
        loadPrivacyState: async () => ({
          accountId: account.id,
          balances: [],
          networkId: "SN_MAIN",
          registration: "pending" as const,
        }),
        preparePrivacyRegistration: async () => {
          prepares += 1;
          return preparation;
        },
      } as unknown as SidepanelWallet,
    } satisfies PrivacyUiDeps;
    bindPrivacy(deps);

    app.querySelector<HTMLButtonElement>("[data-privacy-open]")?.click();
    await tick();

    // The whole point of the pending state: a duplicate registration is never
    // broadcast just because the indexer has not caught up.
    expect(prepares).toBe(0);

    // Settling the reading stops the poll this bind started, so no timer leaks
    // into the next test.
    registration = "registered";
    bindPrivacy(deps);
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

  test("drops execution success after the reviewed account scope is reset", async () => {
    const pending = deferred<string>();
    let generation = 0;
    const journeys: PrivacyJourneyState[] = [];
    const app = mount(`<button id="privacy-confirm">Confirm</button>`);
    bindPrivacy({
      app,
      balances: () => [],
      disclosure: () => ({ error: null, loading: true, value: null }),
      generation: () => generation,
      journey: () => ({
        preparation,
        stage: "activate-review" as const,
        tokenId: preparation.tokenId,
      }),
      navigate: () => undefined,
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
