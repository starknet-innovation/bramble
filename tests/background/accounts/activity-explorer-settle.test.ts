/**
 * An explorer row cannot settle a transaction the wallet is still observing
 * (Sherlock 150). The user's node still reports the send as pending; the
 * explorer lists a transfer for its hash. The Activity refresh adds nothing
 * and keeps the row pending, so the Send journey does not report it confirmed
 * and the "could not confirm" notice stays owed. The wallet's own event scan
 * still settles it.
 */
import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { account, extensionSender, makeHarness } from "../../support/wallet-activity-harness";

const HASH = "0xfeed";

const discovered: ActivityEntry = {
  accountId: account.id,
  amount: "1",
  counterparty: "0x0777000000000000000000000000000000000000000000000000000000000abc",
  hash: HASH,
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt: 5_000,
  summary: "Sent 1 ETH to 0x0777…0abc",
  token: "ETH",
};

const refreshed = async (lane: "chain-events" | "explorer") => {
  const { activity, handler } = makeHarness({
    historyLane: lane,
    onChainHistory: [discovered],
    statusReport: { finalizedOnL1: false, found: true, seen: false, status: "pending" },
  });
  await activity.record({
    accountId: account.id,
    hash: HASH,
    kind: "transfer",
    networkId: "SN_MAIN",
    origin: "wallet",
    summary: "Send 1 ETH",
  });
  await handler({ refreshHistory: true, type: "wallet.activity" }, extensionSender);
  return activity.list();
};

describe("an explorer row for a pending send", () => {
  test("leaves it pending", async () => {
    const [row, ...rest] = await refreshed("explorer");
    expect(rest).toEqual([]);
    expect(row?.status).toBe("pending");
    expect(row?.summary).toBe("Send 1 ETH");
  });

  test("while the wallet's own event scan settles it", async () => {
    const [row] = await refreshed("chain-events");
    expect(row?.status).toBe("accepted");
  });
});
