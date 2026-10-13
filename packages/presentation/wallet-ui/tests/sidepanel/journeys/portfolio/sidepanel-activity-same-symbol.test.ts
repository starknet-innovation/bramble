/**
 * Two tracked tokens that share a symbol, run through the real Activity row
 * pipeline (issue 643): the rendered screen, its filter control and its amount
 * sort, under happy-dom. Each row records its token's address, so the feed
 * offers one filter option per contract, picking one shows only that
 * contract's rows, and the amount sort never interleaves the two tokens'
 * amounts. A legacy row that recorded only the symbol keeps working: it falls
 * back to a symbol key, since the shared symbol cannot name one of the two.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TokenConfig } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { ActivityEntry } from "@bramble/transactions/activity";
import {
  type ActivityFilter,
  EMPTY_ACTIVITY_FILTER,
} from "../../../../src/sidepanel/journeys/portfolio/activity-filter";
import {
  type ActivityPricing,
  activityTrackedToken,
} from "../../../../src/sidepanel/journeys/portfolio/activity-format";
import { bindActivity } from "../../../../src/sidepanel/journeys/portfolio/activity-ui";
import {
  resetActivityViewState,
  setActivityViewState,
} from "../../../../src/sidepanel/journeys/portfolio/activity-view-state";
import { activityScreen } from "../../../../src/sidepanel/journeys/portfolio/activity-views";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { makeWallet, paint, walletStatus } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(resetActivityViewState);
afterEach(resetActivityViewState);

const USDC_A = "0xa11ce";
const USDC_B = "0xb0b";

const usdc = (address: string): TokenConfig => ({
  address,
  decimals: 6,
  id: `SN_MAIN:USDC:${address}`,
  name: "USD Coin",
  networkId: "SN_MAIN",
  symbol: "USDC",
});

const pricing: ActivityPricing = {
  currency: "usd",
  prices: {},
  tokens: [usdc(USDC_A), usdc(USDC_B)],
};

const send = (hash: string, amount: string, tokenAddress?: string): ActivityEntry => ({
  accountId: account.id,
  amount,
  hash,
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt: 1752501900000 - Number(hash),
  summary: `Send ${amount} USDC`,
  token: "USDC",
  ...(tokenAddress === undefined ? {} : { tokenAddress }),
});

// Amounts chosen so a sort that merged the two tokens would interleave them:
// A holds 3 and 1, B holds 2.
const feed: readonly ActivityEntry[] = [
  send("0x1", "1", USDC_A),
  send("0x2", "2", USDC_B),
  send("0x3", "3", USDC_A),
];

const mount = (
  filter: ActivityFilter = EMPTY_ACTIVITY_FILTER,
  entries: readonly ActivityEntry[] = feed,
): HTMLElement => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  const { wallet } = makeWallet();
  const paintScreen = (): void => {
    paint(app, activityScreen([], walletStatus, entries, false, null, pricing, null, []));
    bindActivity({
      app,
      repaint: paintScreen,
      render: async (): Promise<void> => paintScreen(),
      wallet: wallet as unknown as Parameters<typeof bindActivity>[0]["wallet"],
    });
  };
  setActivityViewState(filter);
  paintScreen();
  return app;
};

const tokenOptions = (app: HTMLElement): string[] =>
  [...app.querySelectorAll<HTMLOptionElement>("#activity-token option")].map(
    (option) => option.value,
  );

const shown = (app: HTMLElement): string[] =>
  [...app.querySelectorAll<HTMLElement>("#activity-feed li.tx-row")]
    .filter((row) => !row.hasAttribute("hidden"))
    .map((row) => row.dataset["activityAmount"] ?? "");

const choose = (app: HTMLElement, value: string): void => {
  const select = app.querySelector<HTMLSelectElement>("#activity-token");
  if (!select) throw new Error("token control missing");
  select.value = value;
  select.dispatchEvent(new Event("change"));
};

describe("same-symbol tokens in the Activity feed", () => {
  test("offer one filter option per token address", () => {
    expect(tokenOptions(mount())).toEqual(["all", USDC_A, USDC_B]);
  });

  test("filtering on one token shows only that token's rows", () => {
    const app = mount();
    choose(app, USDC_B);
    expect(shown(app)).toEqual(["2"]);
    choose(app, USDC_A);
    expect(shown(app).sort()).toEqual(["1", "3"]);
  });

  test("the amount sort keeps each token's rows together", () => {
    const app = mount({ ...EMPTY_ACTIVITY_FILTER, sort: "amount" });
    const flat = [...app.querySelectorAll<HTMLElement>("#activity-feed .tx-list-flat li.tx-row")];
    expect(flat.map((row) => row.dataset["activityTokenKey"])).toEqual([USDC_A, USDC_A, USDC_B]);
    expect(flat.map((row) => row.dataset["activityAmount"])).toEqual(["3", "1", "2"]);
  });

  test("a legacy row without an address keeps its own symbol key", () => {
    const app = mount(EMPTY_ACTIVITY_FILTER, [...feed, send("0x4", "4")]);
    expect(tokenOptions(app)).toEqual(["all", USDC_A, USDC_B, "symbol:usdc"]);
    choose(app, "symbol:usdc");
    expect(shown(app)).toEqual(["4"]);
  });

  test("a recorded address keeps tokens apart even when neither resolves to a tracked one", () => {
    // Untracked contracts all read "TOKEN", and a token the user stopped
    // tracking resolves to nothing: the recorded address still tells them apart.
    const untracked = feed.map((entry) => ({ ...entry, token: "TOKEN" }));
    const app = mount(EMPTY_ACTIVITY_FILTER, untracked);
    expect(tokenOptions(app)).toEqual(["all", USDC_A, USDC_B]);
    choose(app, USDC_B);
    expect(shown(app)).toEqual(["2"]);
  });

  test("a recorded address prices its own token, but never under another symbol", () => {
    expect(activityTrackedToken(send("0x5", "1", USDC_B), pricing)?.address).toBe(USDC_B);
    // A likely-spam token is recorded under the untracked symbol; its address
    // must not bring back its own symbol's price or logo (Sherlock 249).
    expect(activityTrackedToken({ ...send("0x6", "1", USDC_B), token: "TOKEN" }, pricing)).toBe(
      null,
    );
    // The shared symbol alone names neither token.
    expect(activityTrackedToken(send("0x7", "1"), pricing)).toBe(null);
  });
});
