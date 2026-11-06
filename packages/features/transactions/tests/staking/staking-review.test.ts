/**
 * The staking review sentence: the facts the calls cannot show — the exact
 * approval, the unrewarded exit wait, and a reward address that is not this
 * account — are stated in the text the user confirms.
 */
import { describe, expect, test } from "bun:test";
import { stakingReviewSentence } from "../../src/staking/staking-review";

const member = (rewardAddress: string) => ({
  amount: 1n,
  rewardAddress,
  unclaimedRewards: 1n,
  unpoolAmount: 0n,
  unpoolTime: null,
});
const base = { account: "0xacc", amount: "5", symbol: "STRK", validator: "Val" };

describe("stakingReviewSentence", () => {
  test("states the exact approval and the unstake wait", () => {
    expect(stakingReviewSentence({ ...base, action: "stake", member: "none" })).toBe(
      "Stake 5 STRK with Val. This approves exactly 5 STRK for its pool.",
    );
    expect(stakingReviewSentence({ ...base, action: "unstake", member: member("0xacc") })).toBe(
      "Unstake 5 STRK from Val. It earns no rewards until you withdraw it.",
    );
  });

  test("a claim names STRK whatever the staked token", () => {
    expect(
      stakingReviewSentence({
        ...base,
        action: "claim",
        amount: null,
        member: member("0xacc"),
        symbol: "WBTC",
      }),
    ).toBe("Claim your STRK rewards from Val.");
  });

  test("names a reward address that is not this account, for claims and stakes", () => {
    const elsewhere = member("0x0000beef00000000000000000000000000000000000000000000000000000001");
    expect(
      stakingReviewSentence({ ...base, action: "claim", amount: null, member: elsewhere }),
    ).toBe("Claim your STRK rewards from Val. Rewards are paid to 0xbeef…0001, not this account.");
    expect(stakingReviewSentence({ ...base, action: "stake", member: elsewhere })).toContain(
      "not this account.",
    );
    expect(
      stakingReviewSentence({ ...base, action: "withdraw", amount: null, member: elsewhere }),
    ).toBe("Withdraw your unstaked STRK from Val.");
    expect(
      stakingReviewSentence({ ...base, action: "claim", amount: null, member: member("0x0acc") }),
    ).toBe("Claim your STRK rewards from Val.");
    expect(
      stakingReviewSentence({
        ...base,
        action: "cancel-unstake",
        amount: null,
        member: member("0xacc"),
      }),
    ).toBe("Cancel your unstake and keep the STRK staked with Val.");
  });
});
