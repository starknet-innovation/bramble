/**
 * Each staking action through `wallet.stakingPrepare` and `wallet.stakingExecute` (wallet-core
 * P13 `staking::{calls, review, prepare}`): the node's traffic for the pinned read, the calls
 * estimated and submitted, the review sentence, and the Activity row and allowance filed for the
 * signed hash; or the refusal (see `./index.ts`).
 */
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { STAKER, type StakingChainState } from "../../tests/support/staking-chain";
import { background, chainWith, member, NOW_SECONDS, plain } from "./shared";

const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const E18 = 10n ** 18n;

type Member = NonNullable<StakingChainState["member"]>;
const withMember = (overrides: Partial<Member>, chain: Partial<StakingChainState> = {}) =>
  chainWith({ ...chain, member: member(overrides) });

type Ask = {
  readonly action: string;
  readonly amount?: string;
  readonly staker?: string;
  readonly symbol?: string;
};

const ACTION_CASES: readonly (readonly [string, Ask, StakingChainState?])[] = [
  ["stake.enter", { action: "stake", amount: "5" }],
  ["stake.add", { action: "stake", amount: "1.5" }, withMember({})],
  [
    "stake.whileExitPending",
    { action: "stake", amount: "2" },
    withMember({ unpoolAmount: 1n, unpoolTime: NOW_SECONDS + 60 }),
  ],
  ["stake.smallestUnit", { action: "stake", amount: "0.000000000000000001" }],
  [
    "stake.rewardsElsewhere",
    { action: "stake", amount: "3" },
    withMember({ rewardAddress: "0x0777" }),
  ],
  ["stake.leaving", { action: "stake", amount: "1" }, withMember({}, { stakerLeaving: true })],
  ["stake.zero", { action: "stake", amount: "0" }],
  ["stake.tooPrecise", { action: "stake", amount: "1.0000000000000000001" }],
  ["stake.overU128", { action: "stake", amount: "340282366920938463464" }],
  ["stake.unverified", { action: "stake", amount: "5" }, chainWith({ poolStaker: "0x999" })],
  ["stake.unknownStaker", { action: "stake", amount: "5", staker: "0x5a2" }],
  [
    "stake.noPoolForToken",
    { action: "stake", amount: "5", symbol: "ETH" },
    chainWith({ activeTokens: [ETH, STRK_TOKEN_ADDRESS] }),
  ],
  ["stake.tokenNotStakeable", { action: "stake", amount: "5" }, chainWith({ activeTokens: [ETH] })],
  ["stake.rewardsNotStrk", { action: "stake", amount: "5" }, chainWith({ rewardToken: ETH })],
  ["claim.rewards", { action: "claim" }, withMember({ unclaimed: 25n * 10n ** 16n })],
  [
    "claim.rewardsElsewhere",
    { action: "claim" },
    withMember({ rewardAddress: "0x0777", unclaimed: 1n }),
  ],
  ["claim.leaving", { action: "claim" }, withMember({ unclaimed: 1n }, { stakerLeaving: true })],
  ["claim.none", { action: "claim" }, withMember({})],
  ["claim.notMember", { action: "claim" }],
  ["unstake.part", { action: "unstake", amount: "2" }, withMember({})],
  ["unstake.all", { action: "unstake", amount: "5" }, withMember({})],
  ["unstake.more", { action: "unstake", amount: "6" }, withMember({})],
  ["unstake.zero", { action: "unstake", amount: "0" }, withMember({})],
  ["unstake.notMember", { action: "unstake", amount: "1" }],
  [
    "unstake.exitPending",
    { action: "unstake", amount: "1" },
    withMember({ unpoolAmount: E18, unpoolTime: NOW_SECONDS + 60 }),
  ],
  [
    "unstake.withdrawable",
    { action: "unstake", amount: "1" },
    withMember({ unpoolAmount: E18, unpoolTime: NOW_SECONDS }),
  ],
  [
    "cancel.exitPending",
    { action: "cancel-unstake" },
    withMember({ amount: 0n, unpoolAmount: E18, unpoolTime: NOW_SECONDS + 60 }),
  ],
  [
    "cancel.withdrawable",
    { action: "cancel-unstake" },
    withMember({ amount: 0n, unpoolAmount: E18, unpoolTime: NOW_SECONDS - 1 }),
  ],
  ["cancel.none", { action: "cancel-unstake" }, withMember({})],
  [
    "withdraw.ready",
    { action: "withdraw" },
    withMember({ amount: 0n, unpoolAmount: 5n, unpoolTime: NOW_SECONDS }),
  ],
  [
    "withdraw.notYet",
    { action: "withdraw" },
    withMember({ amount: 0n, unpoolAmount: 5n, unpoolTime: NOW_SECONDS + 1 }),
  ],
  ["withdraw.none", { action: "withdraw" }, withMember({})],
  ["withdraw.notMember", { action: "withdraw" }],
  ["invalid.amountOnClaim", { action: "claim", amount: "1" }, withMember({ unclaimed: 1n })],
  ["invalid.noAmount", { action: "stake" }],
  ["invalid.amountText", { action: "stake", amount: "1e3" }],
  ["invalid.amountComma", { action: "stake", amount: "1,5" }],
  ["invalid.amountLeadingDot", { action: "stake", amount: ".5" }],
  ["invalid.zeroStaker", { action: "stake", amount: "1", staker: "0x0" }],
  ["invalid.upperStaker", { action: "stake", amount: "1", staker: "0xABC" }],
];

/** Each action: what was asked, the node's traffic and everything the extension produced. */
export const computeActions = async () => {
  const out: object[] = [];
  for (const [name, ask, chain] of ACTION_CASES) {
    const run = await background(chain === undefined ? {} : { chain });
    const token = run.tokens.find((item) => item.symbol === (ask.symbol ?? "STRK"));
    const staker = ask.staker ?? STAKER;
    const prepared = await run.send({
      action: ask.action,
      staker,
      tokenId: token?.id ?? "",
      type: "wallet.stakingPrepare",
      ...(ask.amount === undefined ? {} : { amount: ask.amount }),
    });
    const review = "stakingPreparation" in prepared ? prepared.stakingPreparation : null;
    if (review) await run.send({ preparationId: review.id, type: "wallet.stakingExecute" });
    const rows = await run.activity.list();
    const allowances = await run.allowanceStore.list();
    out.push({
      action: ask.action,
      activity: rows.map((row) => ({
        amount: row.amount ?? null,
        kind: row.kind,
        summary: row.summary,
        token: row.token ?? null,
        tokenAddress: row.tokenAddress ?? null,
      })),
      allowances: allowances.map((row) =>
        plain({ amount: row.amount, spender: row.spender, token: row.token }),
      ),
      amount: ask.amount ?? null,
      // The calls estimated for review; the background submits exactly these.
      calls: plain(run.estimated[0] ?? null),
      name,
      now: NOW_SECONDS,
      prepared: review ? { review: review.review } : plain(prepared),
      rpc: run.rpc,
      staker,
      tokenId: token?.id ?? null,
    });
  }
  return out;
};
