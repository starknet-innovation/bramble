/**
 * Where a staking action's review line sits and how it reads: directly above
 * the control it belongs to, with that control's group opened so the typed
 * amount stays full width; a refusal marked as an error and an unknown outcome
 * as a warning; Unstake in the secondary style; and a reward address spelled
 * the same on the row as in the review sentence.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { stakingReviewSentence } from "@bramble/transactions/staking-review";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type { StakingRow } from "../../../../src/sidepanel/journeys/staking/staking-client";
import { STAKING_LOADING } from "../../../../src/sidepanel/journeys/staking/staking-directory-client";
import { positionLines } from "../../../../src/sidepanel/journeys/staking/staking-position-lines";
import { bindStaking } from "../../../../src/sidepanel/journeys/staking/staking-ui";
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
const ROW: StakingRow = {
  accepting: true,
  commission: "10%",
  delegated: "1000",
  staked: "5",
  staker: STAKER,
  state: "staked",
  symbol: "STRK",
  tokenId: "SN_MAIN:strk",
  unclaimed: "1",
  unpoolAmount: "0",
};
const PREP = {
  id: `sha256:${"a".repeat(64)}`,
  review: "Unstake 2 STRK.",
  reviewedFee: { overallFee: "1000000000000000", unit: "FRI" },
} as const;

const mount = (
  row: StakingRow,
  prepare: () => Promise<typeof PREP> = async () => PREP,
  execute: () => Promise<string> = async () => "0x5ab",
) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  document.body.append(app);
  app.innerHTML = stakingFlow(status, account, {
    ...STAKING_LOADING,
    selected: { name: "Val", staker: STAKER },
    validator: { exitWindowSeconds: 604_800, rows: [row] },
  });
  bindStaking({
    app,
    render: async () => undefined,
    wallet: { executeStaking: execute, prepareStaking: prepare },
  });
  const pick = (action: string) => {
    const button = app.querySelector<HTMLButtonElement>(`[data-staking-action="${action}"]`);
    if (!button) throw new Error(`${action} not rendered`);
    return button;
  };
  const review = app.querySelector<HTMLElement>("[data-staking-review-for]");
  if (!review) throw new Error("not rendered");
  const field =
    app.querySelector<HTMLInputElement>('[data-staking-amount^="unstake|"]') ??
    document.createElement("input");
  return { app, field, pick, review };
};

describe("staking review line", () => {
  test("sits directly above its confirm, in an opened group, with the amount kept", async () => {
    const { field, pick, review } = mount(ROW);
    const unstake = pick("unstake");
    field.value = "2";
    unstake.click();
    await tick();
    const form = unstake.closest(".staking-form");
    expect(review.nextElementSibling).toBe(unstake);
    expect(form?.hasAttribute("data-staking-open")).toBe(true);
    expect(form?.contains(field)).toBe(true);
    expect(field.value).toBe("2");
    expect(review.textContent).toContain("Maximum network fee:");
    expect(unstake.textContent).toContain("Confirm");
  });

  test("moves with the action under review and closes the previous group", async () => {
    const { field, pick, review } = mount(ROW);
    const unstake = pick("unstake");
    const claim = pick("claim");
    field.value = "2";
    unstake.click();
    await tick();
    claim.click();
    await tick();
    expect(review.nextElementSibling).toBe(claim);
    expect(claim.closest(".staking-actions")?.hasAttribute("data-staking-open")).toBe(true);
    expect(unstake.closest(".staking-form")?.hasAttribute("data-staking-open")).toBe(false);
  });

  test("editing the amount hides the line and closes its group", async () => {
    const { field, pick, review } = mount(ROW);
    const unstake = pick("unstake");
    field.value = "2";
    unstake.click();
    await tick();
    field.value = "3";
    field.dispatchEvent(new Event("input"));
    expect(review.hidden).toBe(true);
    expect(unstake.closest(".staking-form")?.hasAttribute("data-staking-open")).toBe(false);
  });

  test("a refusal reads as an error, and a new review clears it", async () => {
    let refuse = true;
    const { pick, review } = mount(ROW, async () => {
      if (refuse) throw new Error("No rewards to claim.");
      return PREP;
    });
    const claim = pick("claim");
    claim.click();
    await tick();
    expect(review.dataset["severity"]).toBe("error");
    expect(review.textContent).toBe("No rewards to claim.");
    refuse = false;
    claim.click();
    await tick();
    expect(review.dataset["severity"]).toBeUndefined();
  });

  test("an unknown outcome reads as a warning and keeps the control down", async () => {
    const { pick, review } = mount(
      { ...ROW, state: "withdrawable", unpoolAmount: "1" },
      async () => PREP,
      async () => {
        throw new Error("staking action failed");
      },
    );
    const withdraw = pick("withdraw");
    withdraw.click();
    await tick();
    withdraw.click();
    await tick();
    expect(review.dataset["severity"]).toBe("warning");
    expect(review.textContent).toContain("Check Activity before trying again.");
    expect(withdraw.disabled).toBe(true);
  });

  test("Unstake uses the secondary style, never the ghost one", () => {
    const unstake = mount(ROW).pick("unstake");
    expect(unstake.classList.contains("secondary")).toBe(true);
    expect(unstake.classList.contains("ghost")).toBe(false);
  });
});

describe("reward address spelling", () => {
  test("the row and the review sentence shorten the same address identically", () => {
    // The same felt, padded and unpadded, as either side might receive it.
    const padded = `0x05e1${"0".repeat(56)}f2e4`;
    const sentence = stakingReviewSentence({
      account: account.address,
      action: "claim",
      amount: null,
      member: {
        amount: 1n,
        rewardAddress: padded,
        unclaimedRewards: 1n,
        unpoolAmount: 0n,
        unpoolTime: null,
      },
      symbol: "STRK",
      validator: "Val",
    });
    for (const rewardsTo of [padded, `0x5e1${"0".repeat(56)}f2e4`]) {
      const line = positionLines({ ...ROW, rewardsTo });
      const short = /Rewards are paid to (\S+)</.exec(line)?.[1];
      expect(short).toBe("0x5e10…f2e4");
      expect(sentence).toContain(`Rewards are paid to ${short},`);
    }
  });
});
