/**
 * Deployment is offered only when privacy is otherwise available, a confirmed
 * registration outranks a stale undeployed cache, and transport failures stay
 * in the wallet's usual wording.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { account, preferences } from "@bramble/testkit/sidepanel";
import {
  PRIVACY_FUNDS_REQUIRED,
  PrivacyBlockerError,
} from "@bramble/wallet-protocol/privacy-blocker";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { homeTabs } from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import { strkAvailableForFees } from "../../../../src/sidepanel/journeys/portfolio/home-view";
import { tokenDetailFlow } from "../../../../src/sidepanel/journeys/portfolio/token-flows";
import type {
  PrivacyDisclosureState,
  PrivacyJourneyState,
} from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import { bindPrivacy } from "../../../../src/sidepanel/journeys/privacy/privacy-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { shieldTile } from "../../../../src/sidepanel/shell/wallet-shell";
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

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const open = (
  initial: PrivacyDisclosureState,
  wallet: Partial<Record<keyof SidepanelWallet, unknown>>,
  deployment: () => boolean | null,
  fundedForFees?: () => boolean | null,
): PrivacyJourneyState[] => {
  const journeys: PrivacyJourneyState[] = [];
  const app = document.createElement("main");
  app.innerHTML = `<button data-privacy-open="token">Shield</button>`;
  document.body.append(app);
  bindPrivacy({
    app,
    balances: () => [],
    deployment,
    disclosure: () => initial,
    ...(fundedForFees ? { fundedForFees } : {}),
    generation: () => 0,
    journey: () => journeys.at(-1) ?? { stage: "idle" },
    navigate: () => undefined,
    paint: () => undefined,
    preferences: () => preferences,
    setDisclosure: () => undefined,
    setJourney: (journey) => {
      journeys.push(journey);
    },
    status: () => status,
    wallet: wallet as unknown as SidepanelWallet,
  });
  app.querySelector<HTMLButtonElement>("[data-privacy-open]")?.click();
  return journeys;
};

describe("privacy deployment gate", () => {
  const prefs = defaultWalletPreferences();
  const token = prefs.tokens.find(
    (entry) => entry.networkId === "SN_MAIN" && entry.symbol === "STRK",
  );
  if (!token) throw new Error("STRK fixture missing");
  const balance = { ...token, balance: "1000000000000000000", formatted: "1" };

  test("keeps a Ledger refusal ahead of a deployment offer", async () => {
    const ledger: PrivacyDisclosureState = {
      blockerKind: "ledger",
      error: "Private balances are not available for Ledger accounts",
      loading: false,
      value: null,
    };
    const html = tokenDetailFlow(status, token, balance, [], null, "usd", ledger, false);
    expect(html).not.toContain("Deploy and enable");
    const journeys = open(
      ledger,
      {
        preparePrivacyRegistration: async () => {
          throw new Error("must not prove");
        },
      },
      () => false,
    );
    await tick();
    const last = journeys.at(-1);
    expect(last?.stage === "blocked" ? last.blocker.kind : null).toBe("ledger");
  });

  test("names the missing funds, not the deployment, when the account cannot pay", async () => {
    // Deploying is the next step, but offering it to an account with no STRK
    // makes the fee estimate the first thing to refuse — as a failed request
    // rather than a screen with somewhere to go.
    const settled: PrivacyDisclosureState = { error: null, loading: false, value: null };
    const journeys = open(
      settled,
      {
        deployAccount: async () => {
          throw new Error("must not deploy");
        },
      },
      () => false,
      () => false,
    );
    await tick();
    const last = journeys.at(-1);
    expect(last?.stage === "blocked" ? last.blocker.kind : null).toBe("fund");
    expect(last?.stage === "blocked" ? last.blocker.message : null).toBe(PRIVACY_FUNDS_REQUIRED);
  });

  test("keeps the deployment path when the balance is merely unknown", async () => {
    // An unread balance is not an empty one: only a settled read that found no
    // STRK may refuse, or a transport failure would look like an empty account.
    const settled: PrivacyDisclosureState = { error: null, loading: false, value: null };
    for (const funded of [null, true]) {
      const journeys = open(
        settled,
        {},
        () => false,
        () => funded,
      );
      await tick();
      const last = journeys.at(-1);
      expect(last?.stage === "blocked" ? last.blocker.kind : null).toBe("deploy");
    }
  });

  test("treats a pending registration as deployed despite a stale undeployed cache", () => {
    const pending: PrivacyDisclosureState = {
      error: null,
      loading: false,
      value: {
        accountId: account.id,
        balances: [],
        networkId: "SN_MAIN",
        poolFeeFri: "0x1",
        relayConfigured: true,
        registration: "pending",
      },
    };
    const html = tokenDetailFlow(status, token, balance, [], null, "usd", pending, false);
    expect(html).toContain("Registration pending");
    expect(html).not.toContain("Deploy and enable");
  });

  test("waits for an in-flight disclosure before offering deployment", async () => {
    let disclosure: PrivacyDisclosureState = { error: null, loading: true, value: null };
    const journeys: PrivacyJourneyState[] = [];
    const app = document.createElement("main");
    app.innerHTML = `<button data-privacy-open="token">Shield</button>`;
    document.body.append(app);
    bindPrivacy({
      app,
      balances: () => [],
      deployment: () => false,
      disclosure: () => disclosure,
      generation: () => 0,
      journey: () => journeys.at(-1) ?? { stage: "idle" },
      navigate: () => undefined,
      paint: () => undefined,
      preferences: () => preferences,
      setDisclosure: (state) => {
        disclosure = state;
      },
      setJourney: (journey) => {
        journeys.push(journey);
      },
      status: () => status,
      wallet: {
        loadPrivacyState: async () => {
          throw new PrivacyBlockerError(
            "ledger",
            "Private balances are not available for Ledger accounts",
          );
        },
      } as unknown as SidepanelWallet,
    });
    app.querySelector<HTMLButtonElement>("[data-privacy-open]")?.click();
    await tick();
    const last = journeys.at(-1);
    expect(last?.stage === "blocked" ? last.blocker.kind : null).toBe("ledger");
  });

  test("does not treat a failed balance load as an empty STRK balance", () => {
    expect(strkAvailableForFees({ error: "fetch failed" })).toBeNull();
    const html = shieldTile(
      token.id,
      false,
      false,
      strkAvailableForFees({ error: "fetch failed" }),
    );
    // An unknown balance is not a zero balance: the tile must not divert to
    // Receive as it does for an account known to be unfunded.
    expect(html).toContain("deploy this account first");
    expect(html).not.toContain("Fund with STRK");
    expect(html).not.toContain('data-view="receive"');
  });

  test("does not ask the chain when privacy is already unavailable", async () => {
    let deploymentReads = 0;
    const journeys = open(
      {
        blockerKind: "network",
        error: "Private balances are not configured for this network",
        loading: false,
        value: null,
      },
      {
        loadDeploymentStatus: async () => {
          deploymentReads += 1;
          throw new Error("rpc down");
        },
      },
      () => null,
    );
    await tick();
    const last = journeys.at(-1);
    expect(last?.stage === "blocked" ? last.blocker.kind : null).toBe("network");
    expect(deploymentReads).toBe(0);
  });

  test("keeps the token screen on Shield when the account cannot pay yet", () => {
    const html = tokenDetailFlow(
      status,
      token,
      { ...balance, balance: "0x0", formatted: "0" },
      [],
      null,
      "usd",
      { error: null, loading: false, value: null },
      false,
    );
    // The privacy journey decides which prerequisite to name, and says so on a
    // screen with a next step; the control stays the thing the user asked for.
    expect(html).toContain("Shield");
    expect(html).toContain('data-privacy-open="');
    expect(html).not.toContain("Fund with STRK");
    expect(html).not.toContain('data-view="receive"');
    expect(html).not.toContain("Deploy and enable");
  });

  test("keeps the token row's private-balance line on Shield when unfunded", () => {
    const html = homeTabs(
      { balances: [balance] },
      prefs,
      {},
      {},
      "usd",
      { error: null, loading: false, value: null },
      false,
      false,
    );
    // Every shielding entry point reads the same and goes to the same place;
    // the privacy screen names the prerequisite that is actually in the way.
    expect(html).toContain("Shield");
    expect(html).toContain("data-privacy-register=");
    expect(html).not.toContain("Fund with STRK");
    expect(html).not.toContain('data-view="receive"');
    expect(html).not.toContain("Deploy and enable");
  });

  test("keeps the tile on Shield when the account is undeployed and unfunded", () => {
    // Funding and deployment are both steps on the way to shielding, so the
    // tile stays one word and one destination; the privacy screen it opens
    // names whichever prerequisite is in the way. The accessible name says so
    // before the tap.
    const tile = shieldTile(token.id, false, false, false);
    expect(tile).toContain(">Shield<");
    expect(tile).toContain('data-privacy-open="');
    expect(tile).toContain("Shield — add STRK to this account first");
    expect(tile).not.toContain("Fund with STRK");
    expect(tile).not.toContain('data-view="receive"');
  });

  test("keeps a transport failure friendly without dropping its blocker kind", async () => {
    const journeys = open(
      {
        error: null,
        loading: false,
        value: {
          accountId: account.id,
          balances: [],
          networkId: "SN_MAIN",
          poolFeeFri: "0x1",
          relayConfigured: true,
          registration: "unregistered",
        },
      },
      {
        preparePrivacyRegistration: async () => {
          throw new Error("Failed to fetch");
        },
      },
      () => true,
    );
    await tick();
    const last = journeys.at(-1);
    expect(last?.stage === "blocked" ? last.blocker : null).toEqual({
      kind: "service",
      message: "Couldn't reach the network. Check your connection or RPC endpoint.",
    });
  });
});
