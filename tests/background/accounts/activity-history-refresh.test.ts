/**
 * When the background re-scans on-chain history for the activity feed.
 *
 * Discovery is deliberately expensive — a key-filtered event scan over a block
 * window — so it is gated twice: the panel asks for it only from the Activity
 * screen, and the background then suppresses it for a freshness window. The gap
 * that gating left is a user who acts and immediately looks: their own
 * transaction has moved the chain, but the cached scan is still considered
 * fresh, so the feed shows the state from before they acted until the window
 * expires or they press refresh.
 *
 * These tests pin both halves: a transaction recorded since the last scan makes
 * the next read scan, and an ambient read still never scans at all.
 */
import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { account, extensionSender, makeHarness } from "../../support/wallet-activity-harness";

const chainOnly: ActivityEntry = {
  accountId: account.id,
  amount: "3",
  counterparty: "0x0777000000000000000000000000000000000000000000000000000000000abc",
  hash: "0xc4a1",
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt: 5_000_000,
  summary: "Received 3 ETH from 0x7770…0abc",
  token: "ETH",
};

const submitted = (hash: string) => ({
  accountId: account.id,
  hash,
  kind: "invoke" as const,
  networkId: "SN_MAIN" as const,
  summary: `Swap via ${hash}`,
});

describe("activity history refresh", () => {
  test("a transaction recorded since the last scan makes the next read scan again", async () => {
    const { activity, handler, historyRequests } = makeHarness({ onChainHistory: [chainOnly] });

    await handler({ refreshHistory: true, type: "wallet.activity" }, extensionSender);
    expect(historyRequests()).toBe(1);

    // The freshness window holds while nothing has happened.
    await handler({ refreshHistory: true, type: "wallet.activity" }, extensionSender);
    expect(historyRequests()).toBe(1);

    // The user acts. That is precisely what invalidates the cached scan.
    await activity.record(submitted("0xfeed"));
    await handler({ refreshHistory: true, type: "wallet.activity" }, extensionSender);
    expect(historyRequests()).toBe(2);

    // One extra scan per transaction, not one per read: it settles again.
    await handler({ refreshHistory: true, type: "wallet.activity" }, extensionSender);
    expect(historyRequests()).toBe(2);
  });

  test("an ambient read still never scans, however recent the transaction", async () => {
    // The guard against RPC amplification: Home and the ambient tick do not ask
    // for history, and a fresh local transaction must not change that.
    const { activity, handler, historyRequests } = makeHarness({ onChainHistory: [chainOnly] });
    await activity.record(submitted("0xfeed"));

    await handler({ type: "wallet.activity" }, extensionSender);
    expect(historyRequests()).toBe(0);

    await handler({ cached: true, type: "wallet.activity" }, extensionSender);
    expect(historyRequests()).toBe(0);
  });
});
