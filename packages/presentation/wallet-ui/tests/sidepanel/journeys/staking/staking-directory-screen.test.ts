/**
 * The staking list (issue 750): Starkscan's directory, re-validated strictly
 * in the panel, rendered as escaped text with no links or remote images,
 * unknown figures shown as unknown, incomplete coverage hidden, and a pasted
 * address that always works. Opening a validator records only its address.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  appendDirectoryPage,
  createStakingDirectoryRuntimeClient,
  MAX_LISTED_VALIDATORS,
  pastedStaker,
  STAKING_LOADING,
  type StakingDirectoryEntry,
  type StakingDirectoryState,
  type StakingState,
  sortedEntries,
  stakingDirectoryFrom,
} from "../../../../src/sidepanel/journeys/staking/staking-directory-client";
import { bindStakingDirectory } from "../../../../src/sidepanel/journeys/staking/staking-directory-ui";
import { stakingFlow } from "../../../../src/sidepanel/journeys/staking/staking-views";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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

const entry = (overrides: Partial<StakingDirectoryEntry> = {}): StakingDirectoryEntry => ({
  commission: "5%",
  commissionPpm: 50_000,
  name: "Validator One",
  pools: [{ delegated: "1,500", symbol: "STRK" }],
  staker: STAKER,
  uptime: "99.5%",
  uptimePpm: 995_000,
  website: "validator.example",
  ...overrides,
});

const listed = (
  entries: readonly StakingDirectoryEntry[],
  extra: Partial<Extract<StakingDirectoryState, { entries: unknown }>> = {},
): StakingState => ({
  ...STAKING_LOADING,
  directory: { entries, nextCursor: null, ...extra },
});

const reply = (directory: unknown) => ({ ok: true, stakingDirectory: directory });

describe("stakingDirectoryFrom", () => {
  test("accepts each state the background sends", () => {
    expect(stakingDirectoryFrom(reply({ state: "off" }))).toEqual({ off: true });
    expect(stakingDirectoryFrom(reply({ state: "incomplete" }))).toEqual({ incomplete: true });
    expect(
      stakingDirectoryFrom(reply({ entries: [entry()], nextCursor: "c1", state: "ready" })),
    ).toEqual({ entries: [entry()], nextCursor: "c1" });
    expect(stakingDirectoryFrom({ error: "Staking isn't available on this network." })).toEqual({
      unavailable: "Staking isn't available on this network.",
    });
  });

  test("anything else reads as unavailable, never as an empty list", () => {
    const ready = (entries: readonly unknown[], nextCursor: unknown = null) =>
      stakingDirectoryFrom(reply({ entries, nextCursor, state: "ready" }));
    for (const result of [
      stakingDirectoryFrom(null),
      stakingDirectoryFrom({ ...reply({ state: "off" }), extra: 1 }),
      stakingDirectoryFrom(reply({ entries: [], state: "off" })),
      ready([{ ...entry(), pool: "0x1" }]),
      ready([entry({ staker: "0x05a2" })]),
      ready([entry({ staker: "0x0" })]),
      ready([entry({ pools: [] })]),
      ready([entry({ commissionPpm: 1_000_001 })]),
      ready([entry({ uptimePpm: -1 })]),
      ready([entry({ name: "" })]),
      ready([entry({ name: "n".repeat(121) })]),
      ready(Array.from({ length: 51 }, () => entry())),
      ready([entry()], "has space"),
    ]) {
      expect(result).toMatchObject({ unavailable: expect.any(String) });
    }
  });
});

describe("list helpers", () => {
  const a = entry({ commissionPpm: 100_000, staker: "0xa", uptimePpm: 900_000 });
  const b = entry({ commissionPpm: null, staker: "0xb", uptimePpm: null });
  const c = entry({ commissionPpm: 0, staker: "0xc", uptimePpm: 999_000 });

  test("sorting keeps the directory's order for stake and puts unknown figures last", () => {
    const order = (sort: StakingState["sort"]) =>
      sortedEntries([a, b, c], sort).map((item) => item.staker);
    expect(order("stake")).toEqual(["0xa", "0xb", "0xc"]);
    expect(order("commission")).toEqual(["0xc", "0xa", "0xb"]);
    expect(order("uptime")).toEqual(["0xc", "0xa", "0xb"]);
  });

  test("a next page appends new validators only, up to the cap", () => {
    const first = { entries: [a, b], nextCursor: "c1" };
    expect(appendDirectoryPage(first, { entries: [b, c], nextCursor: "c2" })).toEqual({
      entries: [a, b, c],
      nextCursor: "c2",
    });
    // A later page reporting incomplete coverage, or no route, drops the list.
    expect(appendDirectoryPage(first, { incomplete: true })).toEqual({ incomplete: true });
    expect(appendDirectoryPage(first, { off: true })).toEqual({ off: true });
    expect(appendDirectoryPage(first, { unavailable: "Nope." })).toEqual({
      entries: [a, b],
      moreError: "Nope.",
      nextCursor: "c1",
    });
    const many = Array.from({ length: MAX_LISTED_VALIDATORS }, (_, index) =>
      entry({ staker: `0x${(index + 16).toString(16)}` }),
    );
    expect(
      appendDirectoryPage(
        { entries: many.slice(0, 499), nextCursor: "c" },
        {
          entries: many.slice(499).concat(entry({ staker: "0xfffff" })),
          nextCursor: "d",
        },
      ),
    ).toMatchObject({ entries: { length: MAX_LISTED_VALIDATORS }, nextCursor: null });
  });

  test("a pasted address is trimmed and canonical, or refused", () => {
    expect(pastedStaker(`  ${STAKER.toUpperCase().replace("0X", "0x")} `)).toBe(STAKER);
    expect(pastedStaker("0x000abc")).toBe("0xabc");
    for (const bad of ["", "0x0", "abc", "0xzz", `0x${"f".repeat(65)}`]) {
      expect(pastedStaker(bad)).toBeNull();
    }
  });
});

describe("the list screen", () => {
  const screen = (state: StakingState) => stakingFlow(status, account, state);

  test("the paste field is there in every directory state", () => {
    for (const directory of [
      { loading: true as const },
      { off: true as const },
      { incomplete: true as const },
      { unavailable: "Couldn't load the validator list. Paste a validator address instead." },
      { entries: [entry()], nextCursor: null },
    ]) {
      expect(screen({ ...STAKING_LOADING, directory })).toContain("data-staking-paste");
    }
  });

  test("incomplete coverage lists nobody and says so", () => {
    const html = screen({ ...STAKING_LOADING, directory: { incomplete: true } });
    expect(html).toContain("Starkscan&#39;s validator list is incomplete right now.");
    expect(html).not.toContain("data-staking-open");
  });

  test("shows each validator's address, figures and source", () => {
    const html = screen(listed([entry()]));
    expect(html).toContain("Listed by Starkscan. Check the address before you stake.");
    expect(html).toContain("Validator One");
    expect(html).toContain("0x5a20…beef");
    expect(html).toContain("Commission 5% · 30-day uptime 99.5%");
    expect(html).toContain("1,500 STRK delegated");
    expect(html).toContain("validator.example");
    expect(html).toContain(`data-staking-open="${STAKER}"`);
  });

  test("unknown figures read as unknown, never 0", () => {
    const html = screen(
      listed([
        entry({
          commission: null,
          commissionPpm: null,
          name: null,
          pools: [{ delegated: null, symbol: "STRK" }],
          uptime: null,
          uptimePpm: null,
          website: null,
        }),
      ]),
    );
    expect(html).toContain("Commission unknown · 30-day uptime unknown");
    expect(html).toContain("STRK delegated unknown");
    expect(html).toContain("Unnamed validator");
    expect(html).not.toContain(" 0%");
  });

  test("third-party text is escaped and nothing remote is linked or loaded", () => {
    const html = screen(
      listed([entry({ name: '<img src="https://x.example/p.png">', website: "<a>evil</a>" })]),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href=");
    expect(html).toContain("&lt;img");
  });

  test("an empty page, a failed next page and more pages each say so", () => {
    expect(screen(listed([]))).toContain("No validators with a pool for tokens you track.");
    expect(screen(listed([entry()]))).not.toContain("data-staking-more");
    expect(screen(listed([entry()], { nextCursor: "c1" }))).toContain("data-staking-more");
    expect(screen(listed([entry()], { moreError: "Couldn't load." }))).toContain(
      "Couldn&#39;t load.",
    );
  });
});

describe("bindStakingDirectory", () => {
  const mount = (initial: StakingState, pages: StakingDirectoryState[] = []) => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    document.body.append(app);
    let state = initial;
    let renders = 0;
    const cursors: (string | undefined)[] = [];
    const paint = () => {
      app.innerHTML = stakingFlow(status, account, state);
      bindStakingDirectory({
        app,
        render: async () => {
          renders += 1;
        },
        setState: (next) => {
          state = next;
        },
        state: () => state,
        status: () => status,
        wallet: {
          loadStakingDirectory: async (cursor) => {
            cursors.push(cursor);
            return pages.shift() ?? { unavailable: "Nope." };
          },
        },
      });
    };
    paint();
    return { app, cursors, paint, renders: () => renders, state: () => state };
  };

  const paste = (app: Element, value: string) => {
    const field = app.querySelector<HTMLInputElement>("[data-staking-paste-input]");
    const form = app.querySelector<HTMLFormElement>("[data-staking-paste]");
    if (!field || !form) throw new Error("not rendered");
    field.value = value;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
  };

  test("a malformed paste opens nothing and says what to do", () => {
    const view = mount({ ...STAKING_LOADING, directory: { off: true } });
    paste(view.app, "not an address");
    expect(view.state().selected).toBeNull();
    expect(view.renders()).toBe(0);
    const error = view.app.querySelector<HTMLElement>("[data-staking-paste-error]");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toBe("Enter a valid Starknet address.");
  });

  test("a pasted address opens that validator, with no directory needed", () => {
    const view = mount({ ...STAKING_LOADING, directory: { unavailable: "Nope." } });
    paste(view.app, ` ${STAKER} `);
    expect(view.state().selected).toEqual({ name: null, staker: STAKER });
    expect(view.state().validator).toEqual({ loading: true });
    expect(view.renders()).toBe(1);
  });

  test("opening from the list keeps the address and the directory name only", () => {
    const view = mount(listed([entry()]));
    view.app.querySelector<HTMLButtonElement>("[data-staking-open]")?.click();
    expect(view.state().selected).toEqual({ name: "Validator One", staker: STAKER });
    view.paint();
    view.app.querySelector<HTMLButtonElement>("[data-staking-back]")?.click();
    expect(view.state().selected).toBeNull();
    expect(view.state().directory).toEqual({ entries: [entry()], nextCursor: null });
  });

  test("the order can be changed", () => {
    const view = mount(listed([entry()]));
    const select = view.app.querySelector<HTMLSelectElement>("[data-staking-sort]");
    if (!select) throw new Error("not rendered");
    select.value = "commission";
    select.dispatchEvent(new Event("change"));
    expect(view.state().sort).toBe("commission");
  });

  test("Show more sends the cursor and appends the next page", async () => {
    const next = entry({ name: "Validator Two", staker: "0xb2" });
    const view = mount(listed([entry()], { nextCursor: "c1" }), [
      { entries: [next], nextCursor: null },
    ]);
    view.app.querySelector<HTMLButtonElement>("[data-staking-more]")?.click();
    await tick();
    expect(view.cursors).toEqual(["c1"]);
    expect(view.state().directory).toEqual({ entries: [entry(), next], nextCursor: null });
  });

  test("a page that lands after the list was replaced is dropped", async () => {
    const view = mount(listed([entry()], { nextCursor: "c1" }), [
      { entries: [entry({ staker: "0xb2" })], nextCursor: null },
    ]);
    const more = view.app.querySelector<HTMLButtonElement>("[data-staking-more]");
    const replaced = listed([entry({ staker: "0xc3" })]);
    more?.click();
    // The account or network changed while the page was in flight.
    Object.assign(view.state(), replaced);
    await tick();
    expect(view.state().directory).toEqual(replaced.directory);
  });
});

describe("loadStakingDirectory", () => {
  test("asks for the first page, then by cursor, and reads failures as unavailable", async () => {
    const sent: unknown[] = [];
    const client = createStakingDirectoryRuntimeClient(async (message) => {
      sent.push(message);
      return reply({ state: "off" });
    });
    await client.loadStakingDirectory();
    await client.loadStakingDirectory("c1");
    expect(sent).toEqual([
      { type: "wallet.stakingDirectory" },
      { cursor: "c1", type: "wallet.stakingDirectory" },
    ]);
    const failing = createStakingDirectoryRuntimeClient(async () => {
      throw new Error("gone");
    });
    expect(await failing.loadStakingDirectory()).toEqual({
      unavailable: "Couldn't load the validator list. Paste a validator address instead.",
    });
  });
});
