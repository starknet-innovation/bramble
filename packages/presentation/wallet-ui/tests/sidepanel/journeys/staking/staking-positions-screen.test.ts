/**
 * "Your stakes" in the panel (issue 750): the background's chain-confirmed
 * positions, re-validated strictly, shown at the top of the list with escaped
 * text and a View button that opens that validator. No route: no section and
 * nothing else changes. A failed read is one short line; an incomplete list
 * says so and is never shown as "no stakes". Going back from a validator reads
 * the positions again; other repaints don't.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { MAX_CHECKED_POSITIONS } from "@bramble/transactions/staking-positions";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type { RenderData } from "../../../../src/sidepanel/app/rendering/render-cache";
import { hydrateStaking } from "../../../../src/sidepanel/app/sync/hydrate-staking";
import type { StakingRow } from "../../../../src/sidepanel/journeys/staking/staking-client";
import {
  STAKING_LOADING,
  type StakingState,
} from "../../../../src/sidepanel/journeys/staking/staking-directory-client";
import { bindStakingDirectory } from "../../../../src/sidepanel/journeys/staking/staking-directory-ui";
import {
  createStakingPositionsRuntimeClient,
  type StakingPositionsState,
  stakingPositionsFrom,
} from "../../../../src/sidepanel/journeys/staking/staking-positions-client";
import { stakingFlow } from "../../../../src/sidepanel/journeys/staking/staking-views";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: account.networkId,
  networks: [{ id: account.networkId, name: "Starknet Mainnet" }],
  ready: true,
};

const STAKER = `0x5a2${"0".repeat(56)}beef`;
const UNREADABLE = "Couldn't load your stakes.";

const row = (overrides: Partial<StakingRow> = {}): StakingRow => ({
  accepting: true,
  commission: "10%",
  delegated: "1,000",
  rewardSymbol: "STRK",
  staked: "5",
  staker: STAKER,
  state: "staked",
  symbol: "STRK",
  tokenId: "SN_MAIN:STRK",
  unclaimed: "0.25",
  unpoolAmount: "0",
  ...overrides,
});

const reply = (positions: unknown) => ({ ok: true, stakingPositions: positions });
const withPositions = (positions: StakingPositionsState, extra: Partial<StakingState> = {}) => ({
  ...STAKING_LOADING,
  directory: { off: true } as const,
  positions,
  ...extra,
});
const render = (state: StakingState): HTMLElement => {
  const app = document.createElement("div");
  app.innerHTML = stakingFlow(status, account, state);
  return app;
};

describe("stakingPositionsFrom", () => {
  test("accepts each state the background sends", () => {
    expect(stakingPositionsFrom(reply({ state: "off" }))).toEqual({ off: true });
    expect(stakingPositionsFrom(reply({ complete: false, rows: [row()], state: "ready" }))).toEqual(
      { complete: false, rows: [row()] },
    );
    expect(stakingPositionsFrom({ error: "Staking isn't available on this network." })).toEqual({
      unavailable: "Staking isn't available on this network.",
    });
  });

  test("anything else reads as unavailable, never as an empty list", () => {
    const ready = (extra: Record<string, unknown>) =>
      reply({ complete: true, rows: [row()], state: "ready", ...extra });
    const bad: unknown[] = [
      null,
      { ok: true },
      { ok: true, stakingPositions: { state: "off" }, extra: 1 },
      reply({ state: "off", rows: [] }),
      reply({ state: "incomplete" }),
      ready({ complete: "true" }),
      ready({ complete: undefined }),
      ready({ rows: {} }),
      ready({ rows: [{ ...row(), staker: "0x0" }] }),
      ready({ rows: [{ ...row(), staker: STAKER.toUpperCase() }] }),
      ready({ rows: [{ ...row(), staked: "x".repeat(121) }] }),
      ready({ rows: [{ ...row(), extra: "<b>" }] }),
      ready({ rows: [{ ...row(), refusal: "Couldn't verify this validator on chain." }] }),
      ready({ rows: Array.from({ length: MAX_CHECKED_POSITIONS + 1 }, () => row()) }),
      ready({ extra: true }),
    ];
    for (const value of bad) {
      expect(stakingPositionsFrom(value)).toEqual({ unavailable: UNREADABLE });
    }
  });

  test("the client sends only its type, and a lost reply reads as unavailable", async () => {
    const sent: unknown[] = [];
    const client = createStakingPositionsRuntimeClient(async (message) => {
      sent.push(message);
      return reply({ state: "off" });
    });
    expect(await client.loadStakingPositions()).toEqual({ off: true });
    expect(sent).toEqual([{ type: "wallet.stakingPositions" }]);
    const failing = createStakingPositionsRuntimeClient(async () => {
      throw new Error("gone");
    });
    expect(await failing.loadStakingPositions()).toEqual({ unavailable: UNREADABLE });
  });
});

describe("Your stakes section", () => {
  test("paste-only (both routes off): the paste field alone, no section and no error", () => {
    const app = render(withPositions({ off: true }));
    expect(app.querySelector("[data-staking-paste]")).not.toBeNull();
    expect(app.querySelector("[data-staking-positions]")).toBeNull();
    expect(app.textContent).not.toContain("Your stakes");
    expect(app.querySelector('[role="alert"]:not([hidden])')).toBeNull();
    expect(app.querySelector("[data-staking-entry]")).toBeNull();
  });

  test("absent while loading, and when a complete list is empty", () => {
    for (const positions of [{ loading: true } as const, { complete: true, rows: [] }]) {
      expect(render(withPositions(positions)).textContent).not.toContain("Your stakes");
    }
  });

  test("lists each confirmed position first, with its figures and a View button", () => {
    const app = render(
      withPositions(
        {
          complete: true,
          rows: [
            row(),
            row({
              staked: "0",
              staker: "0xb2",
              state: "exit-pending",
              unclaimed: "0",
              unpoolAmount: "2",
              unpoolTime: 1_800_000_000,
            }),
          ],
        },
        {
          directory: {
            entries: [
              {
                commission: "5%",
                name: "<img src=x>",
                pools: [{ delegated: "1", symbol: "STRK" }],
                staker: STAKER,
                uptime: null,
                website: null,
              },
            ],
            nextCursor: null,
          },
        },
      ),
    );
    const section = app.querySelector("[data-staking-positions]");
    const text = section?.textContent ?? "";
    expect(text).toContain("Your stakes");
    expect(text).toContain("<img src=x>");
    expect(section?.querySelector("img")).toBeNull();
    expect(text).toContain("Staked 5 STRK");
    expect(text).toContain("Rewards 0.25 STRK");
    expect(text).toContain("Validator");
    expect(text).toContain("Unstaking 2 STRK · withdraw from");
    expect(text).not.toContain("Some of your stakes may not be listed.");
    expect(
      [...(section?.querySelectorAll<HTMLButtonElement>("[data-staking-open]") ?? [])].map(
        (button) => button.dataset["stakingOpen"],
      ),
    ).toEqual([STAKER, "0xb2"]);
    // It sits above the paste field.
    const html = app.innerHTML;
    expect(html.indexOf("data-staking-positions")).toBeLessThan(html.indexOf("data-staking-paste"));
  });

  test("an incomplete list says some may be missing, even when nothing was confirmed", () => {
    for (const rows of [[row()], []]) {
      const text = render(withPositions({ complete: false, rows })).textContent ?? "";
      expect(text).toContain("Your stakes");
      expect(text).toContain("Some of your stakes may not be listed.");
    }
  });

  test("a failed read is one short line", () => {
    const app = render(withPositions({ unavailable: UNREADABLE }));
    expect(app.textContent).toContain("Your stakes");
    expect(app.querySelector('[role="alert"]')?.textContent).toBe(UNREADABLE);
  });
});

describe("Your stakes bindings and reads", () => {
  const mount = (initial: StakingState) => {
    let state = initial;
    const app = document.createElement("div");
    const paint = () => {
      app.innerHTML = stakingFlow(status, account, state);
      bindStakingDirectory({
        app,
        render: async () => undefined,
        setState: (next) => {
          state = next;
        },
        state: () => state,
        status: () => status,
        wallet: { loadStakingDirectory: async () => ({ off: true }) },
      });
    };
    paint();
    return { app, paint, state: () => state };
  };

  test("View opens that validator; going back reads Your stakes again", () => {
    const view = mount(withPositions({ complete: true, rows: [row()] }));
    view.app
      .querySelector<HTMLButtonElement>("[data-staking-positions] [data-staking-open]")
      ?.click();
    expect(view.state().selected).toEqual({ name: null, staker: STAKER });
    view.paint();
    view.app.querySelector<HTMLButtonElement>("[data-staking-back]")?.click();
    expect(view.state().positions).toEqual({ loading: true });
  });

  const hydrate = (staking: StakingState) => {
    const calls: string[] = [];
    const cache = { staking } as RenderData;
    const pending: Promise<void>[] = [];
    hydrateStaking(
      {
        cache,
        wallet: {
          loadStakingDirectory: async () => {
            calls.push("directory");
            return { off: true };
          },
          loadStakingPositions: async () => {
            calls.push("positions");
            return { complete: true, rows: [row()] };
          },
          loadStakingValidator: async () => {
            calls.push("validator");
            return { loading: true };
          },
        },
      },
      (load, assign) => {
        pending.push(load.then(assign));
      },
    );
    return { cache, calls, settled: () => Promise.all(pending) };
  };

  test("the list reads Your stakes when not yet loaded or after a failure, and not again", async () => {
    const first = hydrate(STAKING_LOADING);
    await first.settled();
    expect(first.calls).toEqual(["positions", "directory"]);
    expect(first.cache.staking.positions).toEqual({ complete: true, rows: [row()] });
    expect(hydrate(withPositions({ unavailable: UNREADABLE })).calls).toContain("positions");
    expect(hydrate(withPositions({ complete: true, rows: [] })).calls).not.toContain("positions");
    expect(hydrate(withPositions({ off: true })).calls).not.toContain("positions");
  });

  test("an open validator reads only that validator, and a late reply doesn't land", async () => {
    const opened = withPositions({ loading: true }, { selected: { name: null, staker: STAKER } });
    expect(hydrate(opened).calls).toEqual(["validator"]);
    const listing = hydrate(STAKING_LOADING);
    listing.cache.staking = { ...listing.cache.staking, selected: { name: null, staker: STAKER } };
    await listing.settled();
    expect(listing.cache.staking.positions).toEqual({ loading: true });
  });
});
