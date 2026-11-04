/**
 * The staking screen (issue 750): a strict parser for the background's
 * overview, rows that offer only the actions their on-chain state allows, the
 * exit window stated from the chain's own figure, and a two-tap action whose
 * confirm carries exactly the fee and amount the user reviewed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  createStakingRuntimeClient,
  type StakingRow,
  stakingStateFrom,
} from "../../../../src/sidepanel/journeys/staking/staking-client";
import {
  bindStaking,
  stakingReviewText,
} from "../../../../src/sidepanel/journeys/staking/staking-ui";
import {
  exitWindowText,
  stakingFlow,
} from "../../../../src/sidepanel/journeys/staking/staking-views";
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

const ROW: StakingRow = {
  accepting: true,
  commission: "10%",
  delegated: "1000",
  staked: "0",
  state: "none",
  symbol: "STRK",
  tokenId: "SN_MAIN:strk",
  unclaimed: "0",
  unpoolAmount: "0",
  validatorId: "val",
  validatorName: "Val",
};

const FEE = { overallFee: "1000000000000000", unit: "FRI" } as const;

const screen = (rows: readonly StakingRow[], exitWindowSeconds = 604_800): string =>
  stakingFlow(status, account, { exitWindowSeconds, rows });

describe("stakingStateFrom", () => {
  test("accepts the overview shape and nothing beside it", () => {
    const overview = { ok: true, staking: { exitWindowSeconds: 300, rows: [ROW] } };
    expect(stakingStateFrom(overview)).toEqual({ exitWindowSeconds: 300, rows: [ROW] });
    expect(stakingStateFrom({ ...overview, extra: 1 })).toMatchObject({
      unavailable: expect.any(String),
    });
    expect(
      stakingStateFrom({
        ok: true,
        staking: { exitWindowSeconds: 300, rows: [{ ...ROW, pool: "0x1" }] },
      }),
    ).toMatchObject({ unavailable: expect.any(String) });
    expect(
      stakingStateFrom({
        ok: true,
        staking: { exitWindowSeconds: 300, rows: [{ ...ROW, state: "gone" }] },
      }),
    ).toMatchObject({ unavailable: expect.any(String) });
  });

  test("a refusal keeps the background's sentence", () => {
    expect(stakingStateFrom({ error: "Staking isn't available on this network." })).toEqual({
      unavailable: "Staking isn't available on this network.",
    });
    expect(stakingStateFrom(null)).toEqual({
      unavailable: "Couldn't read staking on this network. Try again.",
    });
  });
});

describe("stakingFlow", () => {
  test("states the exit window from the chain's figure", () => {
    expect(exitWindowText(604_800)).toBe("7 days");
    expect(exitWindowText(300)).toBe("5 minutes");
    expect(exitWindowText(3_600)).toBe("1 hour");
    expect(exitWindowText(42)).toBe("42 seconds");
    expect(screen([ROW])).toContain("Unstaking takes 7 days, with no rewards while you wait.");
  });

  test("loading, unavailable and locked never read as an empty list", () => {
    expect(stakingFlow(status, account, { loading: true })).toContain("Loading staking…");
    expect(stakingFlow(status, account, { unavailable: "Nope." })).toContain("Nope.");
    expect(stakingFlow(status, null, { loading: true })).toContain(
      "Unlock an account on this network to stake.",
    );
    expect(screen([])).toContain("No validators to stake with on tokens you track.");
  });

  test("a new position offers only Stake", () => {
    const html = screen([ROW]);
    expect(html).toContain('data-staking-action="stake"');
    expect(html).not.toContain('data-staking-action="unstake"');
    expect(html).not.toContain('data-staking-action="claim"');
    expect(html).toContain("Commission 10% · 1000 STRK delegated");
  });

  test("a staked position with rewards offers claim and unstake", () => {
    const html = screen([{ ...ROW, staked: "5", state: "staked", unclaimed: "0.25" }]);
    expect(html).toContain("Staked 5 STRK");
    expect(html).toContain("Rewards 0.25 STRK");
    expect(html).toContain('data-staking-action="claim"');
    expect(html).toContain('data-staking-action="unstake"');
  });

  test("an exit waits, then withdraws; both can be cancelled", () => {
    const pending = screen([
      { ...ROW, state: "exit-pending", unpoolAmount: "2", unpoolTime: 1_900_000_000 },
    ]);
    expect(pending).toContain("Unstaking 2 STRK · withdraw from 17 Mar 2030, 17:46 UTC");
    expect(pending).toContain('data-staking-action="cancel-unstake"');
    expect(pending).not.toContain('data-staking-action="withdraw"');
    const ready = screen([{ ...ROW, state: "withdrawable", unpoolAmount: "2", unpoolTime: 1 }]);
    expect(ready).toContain("2 STRK ready to withdraw");
    expect(ready).toContain('data-staking-action="withdraw"');
  });

  test("a leaving validator takes no stake; an unverified one offers nothing", () => {
    expect(screen([{ ...ROW, accepting: false }])).toContain("This validator is leaving staking.");
    expect(screen([{ ...ROW, accepting: false }])).not.toContain('data-staking-action="stake"');
    const refused = screen([
      {
        symbol: "STRK",
        tokenId: "t",
        validatorId: "v",
        validatorName: "V",
        refusal: "Couldn't verify this validator on chain.",
      },
    ]);
    expect(refused).toContain("Couldn&#39;t verify this validator on chain.");
    expect(refused).not.toContain("data-staking-action");
  });

  test("names are escaped", () => {
    expect(screen([{ ...ROW, validatorName: "<b>x</b>" }])).not.toContain("<b>x</b>");
  });
});

describe("stakingReviewText", () => {
  test("says what will be signed, including the exact approval", () => {
    const facts = { amount: "5", symbol: "STRK", validator: "Val" };
    expect(stakingReviewText("stake", facts, "0.001 STRK")).toBe(
      "Stake 5 STRK with Val. This approves exactly 5 STRK for its pool. Maximum network fee: 0.001 STRK.",
    );
    expect(stakingReviewText("unstake", facts, "0.001 STRK")).toContain(
      "It earns no rewards until you withdraw it.",
    );
  });
});

describe("bindStaking", () => {
  const mount = (respond: (request: unknown, fee: unknown) => Promise<unknown>) => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    document.body.append(app);
    app.innerHTML = screen([ROW]);
    const calls: { request: unknown; fee: unknown }[] = [];
    bindStaking({
      app,
      render: async () => undefined,
      wallet: {
        stakingAction: async (request, fee) => {
          calls.push({ fee, request });
          return (await respond(request, fee)) as never;
        },
      },
    });
    const button = app.querySelector<HTMLButtonElement>('[data-staking-action="stake"]');
    const field = app.querySelector<HTMLInputElement>("[data-staking-amount]");
    const review = app.querySelector<HTMLElement>("[data-staking-review-for]");
    return { button, calls, field, review };
  };

  test("first tap reviews the fee; second submits with exactly that fee and amount", async () => {
    const { button, calls, field, review } = mount(async (_request, fee) => (fee ? "0x5ab" : FEE));
    if (!button || !field || !review) throw new Error("not rendered");
    button.click();
    expect(calls).toEqual([]);
    field.value = "5";
    button.click();
    await tick();
    expect(calls[0]).toEqual({
      fee: undefined,
      request: { action: "stake", amount: "5", tokenId: "SN_MAIN:strk", validatorId: "val" },
    });
    expect(review.textContent).toContain("Stake 5 STRK with Val.");
    expect(button.textContent).toContain("Confirm");
    button.click();
    await tick();
    expect(calls[1]?.fee).toEqual(FEE);
    expect(review.textContent).toBe("Submitted. Follow it in Activity.");
  });

  test("editing the amount after the review discards the reviewed fee", async () => {
    const { button, calls, field } = mount(async () => FEE);
    if (!button || !field) throw new Error("not rendered");
    field.value = "5";
    button.click();
    await tick();
    field.value = "6";
    field.dispatchEvent(new Event("input"));
    button.click();
    await tick();
    expect(calls[1]).toEqual({
      fee: undefined,
      request: { action: "stake", amount: "6", tokenId: "SN_MAIN:strk", validatorId: "val" },
    });
  });

  test("a refusal re-enables the control and shows the reason", async () => {
    const { button, field, review } = mount(async () => {
      throw new Error("This validator is leaving staking.");
    });
    if (!button || !field || !review) throw new Error("not rendered");
    field.value = "5";
    button.click();
    await tick();
    expect(review.textContent).toContain("This validator is leaving staking.");
    expect(button.disabled).toBe(false);
  });
});

describe("createStakingRuntimeClient", () => {
  test("sends only ids, the action and the amount; returns the fee then the hash", async () => {
    const sent: unknown[] = [];
    const answers: unknown[] = [
      { feeReview: FEE, ok: true },
      { ok: true, transactionHash: "0x5ab" },
    ];
    const client = createStakingRuntimeClient(async (message) => {
      sent.push(message);
      return answers.shift();
    });
    const request = { action: "stake" as const, amount: "5", tokenId: "t", validatorId: "v" };
    expect(await client.stakingAction(request)).toEqual(FEE);
    expect(await client.stakingAction(request, FEE)).toBe("0x5ab");
    expect(sent[1]).toEqual({ ...request, reviewedFee: FEE, type: "wallet.stakingAction" });
  });

  test("the overview is read with its own message and parsed strictly", async () => {
    const sent: unknown[] = [];
    const client = createStakingRuntimeClient(async (message) => {
      sent.push(message);
      return { ok: true, staking: { exitWindowSeconds: 300, rows: [] } };
    });
    expect(await client.loadStaking()).toEqual({ exitWindowSeconds: 300, rows: [] });
    expect(sent).toEqual([{ type: "wallet.stakingOverview" }]);
    const failing = createStakingRuntimeClient(async () => {
      throw new Error("gone");
    });
    expect(await failing.loadStaking()).toEqual({
      unavailable: "Couldn't read staking on this network. Try again.",
    });
  });

  test("an unrecognised answer is an error, never a hash", async () => {
    const client = createStakingRuntimeClient(async () => ({ ok: true }));
    await expect(
      client.stakingAction({ action: "claim", tokenId: "t", validatorId: "v" }),
    ).rejects.toThrow();
  });
});
