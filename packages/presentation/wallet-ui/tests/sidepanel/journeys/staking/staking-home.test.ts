/**
 * Staking on Home and the list's tap targets (issue 750): a Staking tab beside
 * Tokens only where staking is on, built from the chain-confirmed "Your
 * stakes" state with every load state (loading, couldn't load, incomplete,
 * empty); a "Staked" line under the total that opens the tab and never joins
 * the total; whole-card buttons that open a validator from the list, "Your
 * stakes" and Home; the paste field below the list; and real buttons for
 * Claim rewards and Cancel unstake.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { emptyRenderCache } from "../../../../src/sidepanel/app/rendering/render-cache";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import { hydrateView } from "../../../../src/sidepanel/app/sync/hydrate";
import type { StakingRow } from "../../../../src/sidepanel/journeys/staking/staking-client";
import {
  STAKING_LOADING,
  type StakingDirectoryEntry,
  type StakingState,
} from "../../../../src/sidepanel/journeys/staking/staking-directory-client";
import { stakedSummary } from "../../../../src/sidepanel/journeys/staking/staking-home";
import { bindHomeStaking } from "../../../../src/sidepanel/journeys/staking/staking-home-ui";
import type { StakingPositionsState } from "../../../../src/sidepanel/journeys/staking/staking-positions-client";
import { stakingFlow } from "../../../../src/sidepanel/journeys/staking/staking-views";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const statusOn = (networkId: "SN_MAIN" | "SN_SEPOLIA"): WalletStatus => ({
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet",
  networkId,
  networks: [{ id: networkId, name: "Starknet" }],
  ready: true,
});

const preferences = defaultWalletPreferences();
const STRK = preferences.tokens.find(
  (token) => token.networkId === "SN_MAIN" && token.symbol === "STRK",
);
if (!STRK) throw new Error("STRK fixture missing");
const A = `0x5a2${"0".repeat(56)}beef`;
const B = "0xb2";

const row = (overrides: Partial<StakingRow> = {}): StakingRow => ({
  accepting: true,
  commission: "10%",
  delegated: "1000",
  rewardSymbol: "STRK",
  staked: "1000",
  staker: A,
  state: "staked",
  symbol: "STRK",
  tokenId: STRK.id,
  unclaimed: "2.5",
  unpoolAmount: "0",
  ...overrides,
});

const ENTRY: StakingDirectoryEntry = {
  commission: "5%",
  commissionPpm: 50_000,
  name: "<b>Validator One</b>",
  pools: [{ delegated: "1", symbol: "STRK" }],
  staker: A,
  uptime: "99.5%",
  uptimePpm: 995_000,
  website: null,
};

const withPositions = (positions: StakingPositionsState, extra: Partial<StakingState> = {}) => ({
  ...STAKING_LOADING,
  positions,
  ...extra,
});

const home = (staking: StakingState, networkId: "SN_MAIN" | "SN_SEPOLIA" = "SN_MAIN") => {
  const app = document.createElement("div");
  // `staking` is dashboard's last positional parameter (the 39th).
  app.innerHTML = (dashboard as (...args: unknown[]) => string)(
    "home",
    statusOn(networkId),
    [],
    preferences,
    { balances: [] },
    true,
    [],
    [],
    { [STRK.address]: 2 },
    ...Array(29).fill(undefined),
    staking,
  );
  return app;
};

const panel = (app: Element) => app.querySelector("#home-panel-staking");

describe("the Home Staking tab", () => {
  test("is the second tab on Mainnet (Tokens · Staking · NFTs), absent where staking is off", () => {
    const main = home(STAKING_LOADING);
    expect(
      [...main.querySelectorAll('.home-tabs [role="tab"]')].map((tab) => tab.textContent),
    ).toEqual(["Tokens", "Staking", "NFTs"]);
    const sepolia = home(STAKING_LOADING, "SN_SEPOLIA");
    expect(sepolia.querySelector("#home-tab-staking")).toBeNull();
    expect(sepolia.textContent).not.toContain("Staked");
  });

  test("keeps the selected tab: Tokens by default, Staking once chosen", () => {
    const tokens = home(STAKING_LOADING);
    expect(tokens.querySelector("#home-tab-tokens")?.getAttribute("aria-selected")).toBe("true");
    expect(tokens.querySelector("#home-tab-staking")?.getAttribute("aria-selected")).toBe("false");
    expect(tokens.querySelector("#home-tab-staking")?.getAttribute("tabindex")).toBe("-1");
    expect(panel(tokens)?.hasAttribute("hidden")).toBe(true);
    const staking = home({ ...STAKING_LOADING, homeTab: "staking" });
    expect(staking.querySelector("#home-tab-staking")?.getAttribute("aria-selected")).toBe("true");
    expect(staking.querySelector("#home-tab-staking")?.getAttribute("tabindex")).toBe("0");
    expect(panel(staking)?.hasAttribute("hidden")).toBe(false);
    expect(staking.querySelector("#home-panel-tokens")?.hasAttribute("hidden")).toBe(true);
  });

  test("lists each confirmed position as one button, with the Stake button first", () => {
    const app = home(
      withPositions(
        {
          complete: true,
          rows: [
            row(),
            row({
              staked: "0",
              staker: B,
              state: "exit-pending",
              unclaimed: "0",
              unpoolAmount: "5",
              unpoolTime: 1_800_000_000,
            }),
          ],
        },
        { directory: { entries: [ENTRY], nextCursor: null } },
      ),
    );
    const section = panel(app);
    const first = section?.querySelector("button");
    expect(first?.hasAttribute("data-staking-list")).toBe(true);
    expect(first?.textContent).toContain("Stake");
    const cards = [
      ...(section?.querySelectorAll<HTMLButtonElement>("button[data-staking-go]") ?? []),
    ];
    expect(cards.map((card) => card.dataset["stakingGo"])).toEqual([A, B]);
    expect(cards[0]?.textContent).toContain("<b>Validator One</b>");
    expect(cards[0]?.querySelector("b")).toBeNull();
    expect(cards[0]?.textContent).toContain("Staked 1,000 STRK");
    expect(cards[0]?.textContent).toContain("Rewards 2.5 STRK");
    expect(cards[1]?.textContent).toContain("Validator");
    expect(cards[1]?.textContent).toContain("Unstaking 5 STRK · withdraw from");
    // No block elements inside a button.
    expect(section?.querySelector("button p")).toBeNull();
  });

  test("each state: loading, couldn't load, incomplete, empty, and off", () => {
    const text = (positions: StakingPositionsState) =>
      panel(home(withPositions(positions)))?.textContent ?? "";
    const stake = (positions: StakingPositionsState) =>
      panel(home(withPositions(positions)))?.querySelector("[data-staking-list]");
    expect(text({ loading: true })).toContain("Loading staking…");
    expect(text({ unavailable: "Couldn't load your stakes." })).toContain(
      "Couldn't load your stakes.",
    );
    expect(text({ complete: false, rows: [row()] })).toContain(
      "Some of your stakes may not be listed.",
    );
    expect(text({ complete: false, rows: [] })).toContain("Some of your stakes may not be listed.");
    expect(text({ complete: false, rows: [] })).not.toContain("Stake STRK or BTC");
    expect(text({ complete: true, rows: [] })).toContain(
      "Stake STRK or BTC with a validator to earn rewards.",
    );
    expect(text({ unavailable: "Couldn't load your stakes." })).not.toContain("Stake STRK or BTC");
    expect(text({ off: true })).not.toContain("Stake STRK or BTC");
    for (const positions of [
      { loading: true } as const,
      { unavailable: "Couldn't load your stakes." },
      { complete: true, rows: [] },
      { complete: false, rows: [row()] },
      { off: true } as const,
    ]) {
      expect(stake(positions)).not.toBeNull();
    }
  });
});

describe("the Staked line", () => {
  test("sums confirmed stakes per token, under the total, and opens the Staking tab", () => {
    const app = home(
      withPositions({
        complete: true,
        rows: [row({ staked: "1000" }), row({ staked: "250", staker: B })],
      }),
    );
    const line = app.querySelector<HTMLButtonElement>(".hero [data-home-tab-open]");
    expect(line?.tagName).toBe("BUTTON");
    expect(line?.textContent).toBe("Staked 1,250 STRK");
  });

  test("is hidden without a confirmed stake, and where staking is off", () => {
    for (const positions of [
      { loading: true } as const,
      { off: true } as const,
      { unavailable: "Couldn't load your stakes." },
      { complete: true, rows: [] },
      { complete: true, rows: [row({ staked: "0", unclaimed: "1" })] },
    ]) {
      expect(home(withPositions(positions)).querySelector("[data-home-tab-open]")).toBeNull();
    }
    const staked = withPositions({ complete: true, rows: [row()] });
    expect(home(staked, "SN_SEPOLIA").querySelector("[data-home-tab-open]")).toBeNull();
  });

  test("never joins the Home total", () => {
    // 10 STRK held at $2: the total is $20 with or without 1,000 STRK staked.
    const balance = { ...STRK, balance: "0x8ac7230489e80000", formatted: "10" };
    const total = (staking: StakingState) => {
      const app = document.createElement("div");
      app.innerHTML = (dashboard as (...args: unknown[]) => string)(
        "home",
        statusOn("SN_MAIN"),
        [],
        preferences,
        { balances: [balance] },
        true,
        [],
        [],
        { [STRK.address]: 2 },
        ...Array(28).fill(undefined),
        true, // privateTotalWaitOver: show the public total now
        staking,
      );
      return app.querySelector(".hero-total")?.textContent ?? "";
    };
    const staked = withPositions({ complete: true, rows: [row({ staked: "1000" })] });
    expect(total(STAKING_LOADING)).toBe("$20.00");
    expect(total(staked)).toBe("$20.00");
  });

  test("ignores tokens it can't size", () => {
    const state = withPositions({ complete: true, rows: [row({ tokenId: "SN_MAIN:0xdead" })] });
    expect(stakedSummary(state, preferences.tokens)).toBeNull();
  });
});

describe("Home staking bindings", () => {
  const mount = (initial: StakingState) => {
    let state = initial;
    const navigated: string[] = [];
    let renders = 0;
    const app = home(initial);
    document.body.replaceChildren(app);
    const bind = () =>
      bindHomeStaking({
        app,
        navigate: (view) => navigated.push(view),
        render: async () => {
          renders += 1;
          app.innerHTML = home(state).innerHTML;
          bind();
        },
        setState: (next) => {
          state = next;
        },
        state: () => state,
        status: () => statusOn("SN_MAIN"),
      });
    bind();
    return { app, navigated, renders: () => renders, state: () => state };
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("a tab click selects it; arrow keys move between tabs and keep focus", async () => {
    const view = mount(STAKING_LOADING);
    view.app.querySelector<HTMLButtonElement>("#home-tab-staking")?.click();
    await tick();
    expect(view.state().homeTab).toBe("staking");
    expect(document.activeElement?.id).toBe("home-tab-staking");
    view.app
      .querySelector<HTMLButtonElement>("#home-tab-staking")
      ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    await tick();
    expect(view.state().homeTab).toBe("nfts");
    expect(document.activeElement?.id).toBe("home-tab-nfts");
    view.app
      .querySelector<HTMLButtonElement>("#home-tab-nfts")
      ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    await tick();
    expect(view.state().homeTab).toBe("tokens");
    expect(document.activeElement?.id).toBe("home-tab-tokens");
    view.app
      .querySelector<HTMLButtonElement>("#home-tab-tokens")
      ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    await tick();
    expect(view.state().homeTab).toBe("nfts");
  });

  test("the Staked line opens the Staking tab", async () => {
    const view = mount(withPositions({ complete: true, rows: [row()] }));
    view.app.querySelector<HTMLButtonElement>("[data-home-tab-open]")?.click();
    await tick();
    expect(view.state().homeTab).toBe("staking");
    expect(document.activeElement?.id).toBe("home-tab-staking");
  });

  test("Stake opens the validator list; a row opens its validator", () => {
    const list = mount({ ...STAKING_LOADING, selected: { name: null, staker: B } });
    list.app.querySelector<HTMLButtonElement>("[data-staking-list]")?.click();
    expect(list.navigated).toEqual(["staking"]);
    expect(list.state().selected).toBeNull();
    const open = mount(
      withPositions(
        { complete: true, rows: [row()] },
        { directory: { entries: [ENTRY], nextCursor: null } },
      ),
    );
    open.app.querySelector<HTMLButtonElement>("[data-staking-go]")?.click();
    expect(open.navigated).toEqual(["staking"]);
    expect(open.state().selected).toEqual({ name: ENTRY.name, staker: A });
    expect(open.state().validator).toEqual({ loading: true });
  });
});

describe("Home reads", () => {
  const read = async (networkId: "SN_MAIN" | "SN_SEPOLIA", staking: StakingState) => {
    const reads: string[] = [];
    const cache = { ...emptyRenderCache(), staking };
    await hydrateView({
      activeView: "home",
      cache,
      deployment: { load: async () => true },
      signability: { load: async () => null },
      multisig: {
        async loadMultisigs() {
          return { intents: [], multisigs: [] };
        },
      },
      paint: () => undefined,
      selectedMultisigId: null,
      selectedTokenId: null,
      status: statusOn(networkId),
      wallet: {
        loadActivity: async () => ({ entries: [], historyUnavailable: false }),
        loadBalances: async () => ({ accountId: account.id, balances: [], networkId }),
        loadPrices: async () => ({ asOf: null, changes: {}, prices: {}, stale: false }),
        loadStakingDirectory: async () => {
          reads.push("directory");
          return { off: true };
        },
        loadStakingPositions: async () => {
          reads.push("positions");
          return { complete: true, rows: [row()] };
        },
        loadStakingValidator: async () => {
          reads.push("validator");
          return { loading: true };
        },
      },
    } as never);
    return { cache, reads };
  };

  test("Mainnet Home reads Your stakes only, even with a validator left open", async () => {
    const { cache, reads } = await read("SN_MAIN", {
      ...STAKING_LOADING,
      selected: { name: null, staker: A },
    });
    expect(reads).toEqual(["positions"]);
    expect(cache.staking.positions).toEqual({ complete: true, rows: [row()] });
  });

  test("Home reads nothing for staking where it is off", async () => {
    expect((await read("SN_SEPOLIA", STAKING_LOADING)).reads).toEqual([]);
  });
});

describe("the staking list's tap targets", () => {
  const list = (state: StakingState) => {
    const app = document.createElement("div");
    app.innerHTML = stakingFlow(statusOn("SN_MAIN"), account, state);
    document.body.replaceChildren(app);
    return app;
  };

  test("each validator card and each Your stakes row is one focusable button", () => {
    const app = list(
      withPositions(
        { complete: true, rows: [row()] },
        { directory: { entries: [ENTRY], nextCursor: null } },
      ),
    );
    const card = app.querySelector<HTMLButtonElement>(
      "[data-staking-entry] button[data-staking-open]",
    );
    expect(card?.textContent).toContain("Commission 5%");
    expect(card?.getAttribute("type")).toBe("button");
    card?.focus();
    expect(document.activeElement).toBe(card);
    const stake = app.querySelector<HTMLButtonElement>(
      "[data-staking-positions] button[data-staking-open]",
    );
    expect(stake?.textContent).toContain("Staked 1,000 STRK");
    expect(app.querySelector("button p")).toBeNull();
    expect(app.textContent).not.toContain("View");
  });

  test("the paste field sits below the list, under its label", () => {
    const html = list(
      withPositions({ off: true }, { directory: { entries: [ENTRY], nextCursor: null } }),
    ).innerHTML;
    const label = html.indexOf("Validator not listed? Paste its address");
    expect(label).toBeGreaterThan(html.indexOf("data-staking-entry"));
    expect(html.indexOf("data-staking-paste")).toBeGreaterThan(label);
  });

  test("without a list, the paste field follows the line saying so, with no label", () => {
    const html = list(
      withPositions(
        { off: true },
        {
          directory: {
            unavailable: "Couldn't load the validator list. Paste a validator address instead.",
          },
        },
      ),
    ).innerHTML;
    expect(html).not.toContain("Validator not listed?");
    expect(html.indexOf("data-staking-paste")).toBeGreaterThan(
      html.indexOf("Couldn't load the validator list."),
    );
  });

  test("Claim rewards and Cancel unstake are real buttons", () => {
    const app = list({
      ...STAKING_LOADING,
      selected: { name: null, staker: A },
      validator: {
        exitWindowSeconds: 604_800,
        rows: [row({ state: "exit-pending", unpoolAmount: "5", unpoolTime: 1_800_000_000 })],
      },
    });
    for (const action of ["claim", "cancel-unstake"]) {
      const control = app.querySelector(`[data-staking-action="${action}"]`);
      expect(control?.classList.contains("secondary")).toBe(true);
      expect(control?.classList.contains("ghost")).toBe(false);
    }
  });
});
