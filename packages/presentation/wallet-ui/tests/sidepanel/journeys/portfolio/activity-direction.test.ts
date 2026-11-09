/**
 * A transfer row's verb and arrow come from the direction the wallet recorded,
 * never from words in the summary, which embeds a token symbol a third party
 * chooses (Sherlock 196). A token named SWAP, STAKE or RECEIVED must not turn
 * an outgoing transfer into a swap, a stake or a receipt.
 */
import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { activityAppearance } from "../../../../src/sidepanel/journeys/portfolio/activity-format";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const transfer = (summary: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  accountId: ACCOUNT_ID,
  amount: "5",
  hash: "0xabc",
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt: 1,
  summary,
  token: "SWAP",
  ...extra,
});

describe("transfer direction", () => {
  for (const symbol of ["SWAP", "STAKE", "UNSTAKE", "RECEIVED", "APPROVAL", "PRIVATE"]) {
    test(`an outgoing ${symbol} transfer reads as Sent`, () => {
      const appearance = activityAppearance(
        transfer(`Sent 5 ${symbol} to 0x777`, { direction: "out", token: symbol }),
      );
      expect(appearance).toMatchObject({ direction: "out", title: "Sent", type: "transfer" });
    });
  }

  test("an incoming transfer reads as Received whatever the symbol", () => {
    const appearance = activityAppearance(
      transfer("Received 5 STAKE from 0x777", { direction: "in", token: "STAKE" }),
    );
    expect(appearance).toMatchObject({ direction: "in", title: "Received", type: "transfer" });
  });

  test("a discovered row stored before direction existed reads its own prefix", () => {
    expect(activityAppearance(transfer("Sent 5 RECEIVED to 0x777"))).toMatchObject({
      direction: "out",
      title: "Sent",
    });
    expect(activityAppearance(transfer("Received 5 SWAP from 0x777"))).toMatchObject({
      direction: "in",
      title: "Received",
    });
  });

  test("a public send this wallet made reads as Sent", () => {
    const appearance = activityAppearance(
      transfer("Send 5 SWAP to 0x777", { direction: "out", origin: "wallet" }),
    );
    expect(appearance).toMatchObject({ direction: "out", title: "Sent", type: "transfer" });
  });

  test("a wallet row with no recorded direction keeps the summary wording", () => {
    const appearance = activityAppearance(
      transfer("Send 5 STRK privately to 0x777", { origin: "wallet", token: "STRK" }),
    );
    expect(appearance.type).toBe("private");
  });
});
