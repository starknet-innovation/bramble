/**
 * The staking screen with one validator open (issue 750): a strict parser for
 * the background's overview of that staker, rows that offer only the actions
 * their on-chain state allows, the exit window stated from the chain's own
 * figure, and a two-tap action whose confirm carries exactly the fee and
 * amount the user reviewed, for that staker.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  createStakingRuntimeClient,
  type StakingRow,
  stakingValidatorFrom,
} from "../../../../src/sidepanel/journeys/staking/staking-client";
import { STAKING_LOADING } from "../../../../src/sidepanel/journeys/staking/staking-directory-client";
import { bindStaking } from "../../../../src/sidepanel/journeys/staking/staking-ui";
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

const STAKER = `0x5a2${"0".repeat(56)}beef`;

const ROW: StakingRow = {
  accepting: true,
  commission: "10%",
  delegated: "1000",
  staked: "0",
  staker: STAKER,
  state: "none",
  symbol: "STRK",
  tokenId: "SN_MAIN:strk",
  unclaimed: "0",
  unpoolAmount: "0",
};

const FEE = { overallFee: "1000000000000000", unit: "FRI" } as const;

const opened = (
  validator: Parameters<typeof stakingFlow>[2]["validator"],
  name: string | null = "Val",
): string =>
  stakingFlow(status, account, {
    ...STAKING_LOADING,
    selected: { name, staker: STAKER },
    validator,
  });

const screen = (rows: readonly StakingRow[], exitWindowSeconds = 604_800): string =>
  opened({ exitWindowSeconds, rows });

const stakingStateFrom = (response: unknown) => stakingValidatorFrom(response, STAKER);

describe("stakingValidatorFrom", () => {
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
    // Every row must be for the staker that was asked for.
    expect(
      stakingStateFrom({
        ok: true,
        staking: { exitWindowSeconds: 300, rows: [{ ...ROW, staker: "0x5a3" }] },
      }),
    ).toMatchObject({ unavailable: expect.any(String) });
    expect(
      stakingStateFrom({
        ok: true,
        staking: { exitWindowSeconds: 300, rows: [{ ...ROW, staker: "0x05a3" }] },
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
    expect(opened({ loading: true })).toContain("Loading staking…");
    expect(opened({ unavailable: "Nope." })).toContain("Nope.");
    expect(stakingFlow(status, null, STAKING_LOADING)).toContain(
      "Unlock an account on this network to stake.",
    );
    expect(screen([])).toContain("No tokens you track can be staked here.");
  });

  test("names the opened validator by its full address, beside any directory name", () => {
    const html = screen([ROW]);
    expect(html).toContain("<strong>Val</strong>");
    expect(html).toContain(`<code>${STAKER}</code>`);
    expect(html).toContain("data-staking-back");
    expect(html).toContain("All validators");
    expect(opened({ exitWindowSeconds: 1, rows: [] }, null)).toContain(
      "<strong>Validator</strong>",
    );
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
        refusal: "Couldn't verify this validator on chain.",
        staker: STAKER,
        symbol: "STRK",
        tokenId: "t",
      },
    ]);
    expect(refused).toContain("Couldn&#39;t verify this validator on chain.");
    expect(refused).not.toContain("data-staking-action");
  });

  test("rewards are labelled in their own token, not the staked one", () => {
    const html = screen([
      {
        ...ROW,
        rewardSymbol: "STRK",
        staked: "1",
        state: "staked",
        symbol: "WBTC",
        unclaimed: "2",
      },
    ]);
    expect(html).toContain("Rewards 2 STRK");
  });

  test("rewards paid elsewhere are stated on the row", () => {
    expect(screen([{ ...ROW, rewardsTo: "0xabc1234567", staked: "5", state: "staked" }])).toContain(
      "Rewards are paid to",
    );
  });

  test("a directory name is escaped", () => {
    const html = opened({ exitWindowSeconds: 1, rows: [ROW] }, "<b>x</b>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

const PREP = {
  id: `sha256:${"a".repeat(64)}`,
  review: "Stake 5 STRK with Val. This approves exactly 5 STRK for its pool.",
  reviewedFee: FEE,
};

describe("bindStaking", () => {
  const mount = (
    rows: readonly StakingRow[],
    prepare: (request: unknown) => Promise<typeof PREP> = async () => PREP,
    execute: (id: string) => Promise<string> = async () => "0x5ab",
  ) => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    document.body.append(app);
    app.innerHTML = screen(rows);
    const calls: { readonly kind: string; readonly value: unknown }[] = [];
    bindStaking({
      app,
      render: async () => undefined,
      wallet: {
        executeStaking: async (id) => {
          calls.push({ kind: "execute", value: id });
          return execute(id);
        },
        prepareStaking: async (request) => {
          calls.push({ kind: "prepare", value: request });
          return prepare(request);
        },
      },
    });
    const pick = (action: string) =>
      app.querySelector<HTMLButtonElement>(`[data-staking-action="${action}"]`);
    const field = (action: string) =>
      app.querySelector<HTMLInputElement>(`[data-staking-amount^="${action}|"]`);
    const review = app.querySelector<HTMLElement>("[data-staking-review-for]");
    return { calls, field, pick, review };
  };

  test("first tap shows the background's review and fee; second confirms that preparation", async () => {
    const { calls, field, pick, review } = mount([ROW]);
    const button = pick("stake");
    const amount = field("stake");
    if (!button || !amount || !review) throw new Error("not rendered");
    button.click();
    expect(calls).toEqual([]);
    amount.value = "5";
    button.click();
    await tick();
    expect(calls[0]).toEqual({
      kind: "prepare",
      value: { action: "stake", amount: "5", staker: STAKER, tokenId: "SN_MAIN:strk" },
    });
    expect(review.textContent).toContain(`${PREP.review} Maximum network fee:`);
    expect(button.textContent).toContain("Confirm");
    button.click();
    await tick();
    expect(calls[1]).toEqual({ kind: "execute", value: PREP.id });
    expect(review.textContent).toBe("Submitted. Follow it in Activity.");
  });

  test("editing the amount disarms the confirm", async () => {
    const { calls, field, pick } = mount([ROW]);
    const button = pick("stake");
    const amount = field("stake");
    if (!button || !amount) throw new Error("not rendered");
    amount.value = "5";
    button.click();
    await tick();
    amount.value = "6";
    amount.dispatchEvent(new Event("input"));
    button.click();
    await tick();
    expect(calls.map((call) => call.kind)).toEqual(["prepare", "prepare"]);
  });

  test("reviewing another action in the row disarms the first", async () => {
    const { calls, field, pick } = mount([
      { ...ROW, staked: "5", state: "staked", unclaimed: "1" },
    ]);
    const stake = pick("stake");
    const claim = pick("claim");
    const amount = field("stake");
    if (!stake || !claim || !amount) throw new Error("not rendered");
    amount.value = "5";
    stake.click();
    await tick();
    claim.click();
    await tick();
    expect(stake.textContent).toBe("Stake");
    stake.click();
    await tick();
    expect(calls.map((call) => call.kind)).toEqual(["prepare", "prepare", "prepare"]);
  });

  test("overlapping preparations arm only the latest, under its own review", async () => {
    const pending: ((value: typeof PREP) => void)[] = [];
    const { field, pick, review } = mount(
      [{ ...ROW, staked: "5", state: "staked", unclaimed: "1" }],
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const stake = pick("stake");
    const claim = pick("claim");
    const amount = field("stake");
    if (!stake || !claim || !amount || !review) throw new Error("not rendered");
    amount.value = "5";
    stake.click();
    claim.click();
    pending[1]?.({
      ...PREP,
      id: `sha256:${"b".repeat(64)}`,
      review: "Claim your STRK rewards from Val.",
    });
    await tick();
    pending[0]?.(PREP);
    await tick();
    expect(review.textContent).toContain("Claim your STRK rewards from Val.");
    expect(claim.textContent).toContain("Confirm");
    expect(stake.textContent).toBe("Stake");
    expect(stake.disabled).toBe(false);
  });

  test("a refusal re-enables the control and shows the reason", async () => {
    const { field, pick, review } = mount([ROW], async () => {
      throw new Error("This validator is leaving staking.");
    });
    const button = pick("stake");
    const amount = field("stake");
    if (!button || !amount || !review) throw new Error("not rendered");
    amount.value = "5";
    button.click();
    await tick();
    expect(review.textContent).toContain("This validator is leaving staking.");
    expect(button.disabled).toBe(false);
  });
});

describe("createStakingRuntimeClient", () => {
  test("prepare sends ids, action and amount; execute sends only the preparation id", async () => {
    const sent: unknown[] = [];
    const answers: unknown[] = [
      { ok: true, stakingPreparation: PREP },
      { ok: true, transactionHash: "0x5ab" },
    ];
    const client = createStakingRuntimeClient(async (message) => {
      sent.push(message);
      return answers.shift();
    });
    const request = { action: "stake" as const, amount: "5", staker: STAKER, tokenId: "t" };
    expect(await client.prepareStaking(request)).toEqual(PREP);
    expect(await client.executeStaking(PREP.id)).toBe("0x5ab");
    expect(sent).toEqual([
      { ...request, type: "wallet.stakingPrepare" },
      { preparationId: PREP.id, type: "wallet.stakingExecute" },
    ]);
  });

  test("a malformed preparation or hash is an error", async () => {
    const bad = createStakingRuntimeClient(async () => ({
      ok: true,
      stakingPreparation: { ...PREP, id: "x" },
    }));
    await expect(
      bad.prepareStaking({ action: "claim", staker: STAKER, tokenId: "t" }),
    ).rejects.toThrow();
    const none = createStakingRuntimeClient(async () => ({ ok: true }));
    await expect(none.executeStaking(PREP.id)).rejects.toThrow();
  });

  test("the overview is read with its own message and parsed strictly", async () => {
    const sent: unknown[] = [];
    const client = createStakingRuntimeClient(async (message) => {
      sent.push(message);
      return { ok: true, staking: { exitWindowSeconds: 300, rows: [] } };
    });
    expect(await client.loadStakingValidator(STAKER)).toEqual({ exitWindowSeconds: 300, rows: [] });
    expect(sent).toEqual([{ staker: STAKER, type: "wallet.stakingOverview" }]);
    const failing = createStakingRuntimeClient(async () => {
      throw new Error("gone");
    });
    expect(await failing.loadStakingValidator(STAKER)).toEqual({
      unavailable: "Couldn't read staking on this network. Try again.",
    });
  });
});
