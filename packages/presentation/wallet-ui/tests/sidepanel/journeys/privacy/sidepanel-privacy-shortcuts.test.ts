/**
 * The Shield and Unshield entry points on an asset and on Home.
 *
 * Both are sends between one account's two balances, so neither opens a journey
 * of its own: they open Send already configured, with the active account on both
 * ends and the buckets that name the direction. The direction lives entirely in
 * that configuration, so these pin which bucket each button asks for.
 *
 * The activation entry (`data-privacy-open`) is the same control before the
 * account is registered. It must never be a dead click: whatever stops
 * activation — no STRK for the fee, a registration still indexing, no pool on
 * this network, an unreachable service — lands on the privacy screen with the
 * reason and the next step, never on a toast alone. Whatever it has to wait for
 * first is watched on the preparing screen (its own suite,
 * sidepanel-privacy-preparing.test.ts); here only the outcomes are pinned.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type {
  PrivacyDisclosureState,
  PrivacyJourneyState,
} from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import { bindPrivacy } from "../../../../src/sidepanel/journeys/privacy/privacy-ui";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
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

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const settled = (
  registration: "pending" | "registered" | "unregistered",
): PrivacyDisclosureState => ({
  error: null,
  loading: false,
  value: {
    accountId: account.id,
    balances: [],
    networkId: "SN_MAIN",
    poolFeeFri: "0x1",
    relayConfigured: true,
    registration,
  },
});

type Activation = {
  readonly app: HTMLElement;
  readonly intents: readonly SendIntent[];
  readonly journeys: readonly PrivacyJourneyState[];
  readonly views: readonly string[];
};

const bindActivation = (
  initial: PrivacyDisclosureState,
  wallet: Partial<Record<keyof SidepanelWallet, unknown>>,
): Activation => {
  let disclosure = initial;
  const intents: SendIntent[] = [];
  const journeys: PrivacyJourneyState[] = [];
  const views: string[] = [];
  const app = document.createElement("main");
  app.innerHTML = `<button data-privacy-open="${TOKEN_ID}">Shield</button>`;
  document.body.append(app);
  bindPrivacy({
    app,
    balances: () => [],
    disclosure: () => disclosure,
    generation: () => 0,
    // The journey is read back by the entry's own continuations, so it is real
    // state here, as the controller keeps it in production.
    journey: () => journeys.at(-1) ?? { stage: "idle" },
    navigate: (view) => {
      views.push(view);
    },
    openSend: (intent) => {
      intents.push(intent);
    },
    paint: () => undefined,
    preferences: () => preferences,
    setDisclosure: (state) => {
      disclosure = state;
    },
    setJourney: (journey) => {
      journeys.push(journey);
    },
    status: () => status,
    wallet: wallet as unknown as SidepanelWallet,
  });
  return { app, intents, journeys, views };
};

const blockerOf = (journeys: readonly PrivacyJourneyState[]): string | undefined => {
  const last = journeys.at(-1);
  return last?.stage === "blocked" ? last.blocker.kind : undefined;
};

describe("the activation entry", () => {
  test("opens the registration review when the account can register", async () => {
    const preparation = { id: "prep", kind: "register", summaries: [], symbol: "ETH" };
    const { app, journeys, views } = bindActivation(settled("unregistered"), {
      preparePrivacyRegistration: async () => preparation,
    });

    click(app, "[data-privacy-open]");
    await tick();

    // The preparing screen is shown at once; the review replaces it.
    expect(journeys.map((journey) => journey.stage)).toEqual(["preparing", "activate-review"]);
    expect(views).toEqual(["privacy", "privacy"]);
  });

  test("lands on the funding step instead of a toast when STRK is short", async () => {
    // Reproduced on mainnet with an unfunded account: the tile showed a
    // two-second toast and stayed on Home, which read as a dead button.
    const { app, journeys, views } = bindActivation(settled("unregistered"), {
      preparePrivacyRegistration: async () => {
        throw new Error("Not enough STRK for the pool fee");
      },
    });

    click(app, "[data-privacy-open]");
    await tick();

    expect(blockerOf(journeys)).toBe("fund");
    expect(views).toEqual(["privacy", "privacy"]);
    expect(document.querySelector(".toast")).toBeNull();
  });

  test("lands on the deployment step when the account contract is missing", async () => {
    const { app, journeys } = bindActivation(settled("unregistered"), {
      preparePrivacyRegistration: async () => {
        throw new Error("Deploy this account before using public privacy transactions");
      },
    });

    click(app, "[data-privacy-open]");
    await tick();

    expect(blockerOf(journeys)).toBe("deploy");
  });

  test("explains a network without a pool from the disclosure error", async () => {
    // Sepolia: discovery itself refuses, so there is nothing to prepare.
    const { app, journeys, views } = bindActivation(
      { error: null, loading: false, value: null },
      {
        loadPrivacyState: async () => {
          throw new Error("Private balances are not configured for this network");
        },
        preparePrivacyRegistration: async () => {
          throw new Error("must not be reached");
        },
      },
    );

    click(app, "[data-privacy-open]");
    await tick();

    // Discovery had to run first, so the wait was shown before the answer.
    expect(journeys.map((journey) => journey.stage)).toEqual(["preparing", "blocked"]);
    expect(blockerOf(journeys)).toBe("network");
    expect(views).toEqual(["privacy", "privacy"]);
    // The screen explains it; the loader's usual toast stays quiet.
    expect(document.querySelector(".toast")).toBeNull();
  });

  test("explains an indexing registration on its own screen", async () => {
    let prepares = 0;
    const { app, journeys, views } = bindActivation(settled("pending"), {
      loadPrivacyState: async () => settled("pending").value,
      preparePrivacyRegistration: async () => {
        prepares += 1;
        return {};
      },
    });

    click(app, "[data-privacy-open]");
    await tick();

    expect(prepares).toBe(0);
    expect(blockerOf(journeys)).toBe("pending");
    expect(views).toEqual(["privacy"]);
    // Settle the reading so the pending poll this bind started is stopped.
    bindPrivacy({
      app,
      balances: () => [],
      disclosure: () => settled("registered"),
      generation: () => 0,
      journey: () => ({ stage: "idle" }),
      navigate: () => undefined,
      paint: () => undefined,
      preferences: () => preferences,
      setDisclosure: () => undefined,
      setJourney: () => undefined,
      status: () => status,
      wallet: {} as unknown as SidepanelWallet,
    });
  });

  test("becomes the shield shortcut once registration has settled", async () => {
    // The tile was painted on an older reading; the click finds nothing to
    // activate, so it opens Send in its Shield mode rather than doing nothing.
    const { app, intents, journeys, views } = bindActivation(settled("registered"), {});

    click(app, "[data-privacy-open]");
    await tick();

    // No wait and no journey screen: the entry hands straight over to Send.
    expect(journeys).toEqual([{ stage: "idle" }]);
    expect(views).toEqual([]);
    expect(intents).toEqual([
      expect.objectContaining({ destination: "private", source: "public", tokenId: TOKEN_ID }),
    ]);
  });

  test("offers a retry for an unclassified service failure", async () => {
    const { app, journeys } = bindActivation(settled("unregistered"), {
      preparePrivacyRegistration: async () => {
        throw new Error("prover unavailable");
      },
    });

    click(app, "[data-privacy-open]");
    await tick();

    const last = journeys.at(-1);
    expect(last?.stage === "blocked" ? last.blocker : null).toEqual({
      kind: "service",
      message: "prover unavailable",
    });
  });
});
