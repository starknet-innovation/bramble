/** Wallet transaction and activity boundary tests. */
import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@bramble/transactions/activity";
import {
  type ActivityResponse,
  account,
  extensionSender,
  makeHarness,
  OTHER_ACCOUNT_ID,
  reviewedDeploymentFee,
  reviewedFee,
  SEPOLIA_ACCOUNT_ID,
  tokenId,
} from "../../support/wallet-activity-harness";

describe("wallet operations", () => {
  test("review returns decoded summaries, flags, and the fee estimate", async () => {
    const { handler } = makeHarness();
    const response = await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: account.address,
        tokenId,
        type: "wallet.reviewTransfer",
      },
      extensionSender,
    );
    expect(response).toMatchObject({
      ok: true,
      review: {
        fee: { overallFee: "2500000000000000", unit: "FRI" },
        feeEstimateFailed: false,
        requiresDeployment: false,
      },
    });
    const review = (
      response as { review: { flags: readonly { code: string }[]; summaries: readonly string[] } }
    ).review;
    expect(review.summaries[0]).toContain("Send 1.5 ETH");
    expect(review.flags.map((flag) => flag.code)).toContain("self-transfer");
  });
  test("review reports separate invoke and deployment fees when undeployed", async () => {
    const { handler } = makeHarness({ deployed: false });
    const response = await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
        tokenId,
        type: "wallet.reviewTransfer",
      },
      extensionSender,
    );
    expect(response).toMatchObject({
      ok: true,
      review: {
        deploymentFee: reviewedDeploymentFee,
        deploymentFeeEstimateFailed: false,
        fee: reviewedFee,
        feeEstimateFailed: false,
        requiresDeployment: true,
      },
    });
  });
  test("review flags a genuine fee-estimate failure on a deployed account", async () => {
    const { handler } = makeHarness({ deployed: true, estimateFails: true });
    const response = await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
        tokenId,
        type: "wallet.reviewTransfer",
      },
      extensionSender,
    );
    expect(response).toMatchObject({
      ok: true,
      review: { fee: null, feeEstimateFailed: true, requiresDeployment: false },
    });
  });
  const reviewMessage = (overrides?: { amount?: string; tokenId?: string }) => ({
    accountId: account.id,
    amount: overrides?.amount ?? "1.5",
    recipient: "0x777",
    tokenId: overrides?.tokenId ?? tokenId,
    type: "wallet.reviewTransfer",
  });
  const FEE = 2500000000000000n; // the harness estimate

  test("review reports an insufficient STRK balance for the fee", async () => {
    const { handler } = makeHarness({ strkBalance: (FEE - 1n).toString() });
    const response = await handler(reviewMessage(), extensionSender);
    expect(response).toMatchObject({
      ok: true,
      review: { feeAffordability: "insufficient" },
    });
  });

  test("review reports ok when the STRK balance covers the fee", async () => {
    const { handler } = makeHarness({ strkBalance: FEE.toString() });
    const response = await handler(reviewMessage(), extensionSender);
    expect(response).toMatchObject({ ok: true, review: { feeAffordability: "ok" } });
  });

  test("review fails open when the balance cannot be read", async () => {
    const { handler } = makeHarness({ balanceThrows: true });
    const response = await handler(reviewMessage(), extensionSender);
    expect(response).toMatchObject({ ok: true, review: { feeAffordability: "unknown" } });
  });

  test("a STRK send checks amount plus fee against the balance", async () => {
    const strkTokenId =
      "SN_MAIN:STRK:0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
    const amount = 10n ** 18n; // "1" STRK in base units
    const covers = (amount + FEE).toString();
    const short = (amount + FEE - 1n).toString();
    const ok = await makeHarness({ strkBalance: covers }).handler(
      reviewMessage({ amount: "1", tokenId: strkTokenId }),
      extensionSender,
    );
    expect(ok).toMatchObject({ ok: true, review: { feeAffordability: "ok" } });
    const insufficient = await makeHarness({ strkBalance: short }).handler(
      reviewMessage({ amount: "1", tokenId: strkTokenId }),
      extensionSender,
    );
    expect(insufficient).toMatchObject({
      ok: true,
      review: { feeAffordability: "insufficient" },
    });
  });

  test("transfers are recorded and the activity feed refreshes their status", async () => {
    const { activity: activityLog, handler, statusRequests } = makeHarness();
    await activityLog.record({
      accountId: OTHER_ACCOUNT_ID,
      hash: "0x8ab",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Another account send",
    });
    await activityLog.record({
      accountId: SEPOLIA_ACCOUNT_ID,
      hash: "0x9ab",
      kind: "transfer",
      networkId: "SN_SEPOLIA",
      summary: "Another network send",
    });
    await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
        reviewedFee,
        speed: "fast",
        tokenId,
        type: "wallet.transfer",
      },
      extensionSender,
    );
    const response = await handler({ type: "wallet.activity" }, extensionSender);
    expect(response).toMatchObject({ ok: true });
    const activity = (
      response as { activity: readonly { hash: string; status: string; summary: string }[] }
    ).activity;
    expect(activity).toHaveLength(1);
    expect(activity[0]?.hash).toBe("0x7ab");
    expect(activity[0]?.status).toBe("accepted");
    expect(activity[0]?.summary).toContain("Send 1.5 ETH");
    expect(statusRequests).toEqual([["0x7ab"]]);
    const stored = await activityLog.list();
    expect(stored.find((entry) => entry.hash === "0x8ab")?.status).toBe("pending");
    expect(stored.find((entry) => entry.hash === "0x9ab")?.status).toBe("pending");
  });

  test("surfaces a pre-confirmed transaction as provisional in the feed", async () => {
    const { handler } = makeHarness({
      statusReport: { finalizedOnL1: false, found: true, status: "preconfirmed" },
    });
    await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
        reviewedFee,
        speed: "fast",
        tokenId,
        type: "wallet.transfer",
      },
      extensionSender,
    );
    const response = await handler({ type: "wallet.activity" }, extensionSender);
    const activity = (response as { activity: readonly { status: string }[] }).activity;
    expect(activity[0]?.status).toBe("preconfirmed");
  });

  test("drains a late-failure notice exactly once through wallet.transactionAlerts", async () => {
    const { activity: activityLog, handler } = makeHarness({
      statusReport: { finalizedOnL1: false, found: true, status: "reverted" },
    });
    await activityLog.record({
      accountId: account.id,
      hash: "0x7ab",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send 1.5 ETH to 0x777",
    });
    await activityLog.updateStatuses(
      { "0x7ab": { status: "preconfirmed" } },
      { accountId: account.id, networkId: "SN_MAIN" },
    );
    expect(await handler({ type: "wallet.transactionAlerts" }, extensionSender)).toEqual({
      alerts: [],
      ok: true,
    });
    await handler({ type: "wallet.activity" }, extensionSender);

    const first = await handler({ type: "wallet.transactionAlerts" }, extensionSender);
    expect((first as { alerts: readonly string[] }).alerts).toHaveLength(1);
    expect((first as { alerts: readonly string[] }).alerts[0]).toContain("reverted");
    expect(await handler({ type: "wallet.transactionAlerts" }, extensionSender)).toEqual({
      alerts: [],
      ok: true,
    });
    expect((await activityLog.list())[0]?.status).toBe("reverted");
  });

  test("drains notices only for the active account", async () => {
    const { activity: activityLog, handler } = makeHarness();
    await activityLog.record({
      accountId: OTHER_ACCOUNT_ID,
      hash: "0x8ab",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Other account send",
    });
    await activityLog.updateStatuses(
      { "0x8ab": { failureNotice: "pending", status: "reverted" } },
      { accountId: OTHER_ACCOUNT_ID, networkId: "SN_MAIN" },
    );
    expect(await handler({ type: "wallet.transactionAlerts" }, extensionSender)).toEqual({
      alerts: [],
      ok: true,
    });
    expect((await activityLog.list())[0]?.failureNotice).toBe("pending");
  });

  test("does not drain a notice while the wallet is locked", async () => {
    const { activity: activityLog, handler, session } = makeHarness();
    await activityLog.record({
      accountId: account.id,
      hash: "0x9ab",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Locked account send",
    });
    await activityLog.updateStatuses(
      { "0x9ab": { failureNotice: "pending", status: "reverted" } },
      { accountId: account.id, networkId: "SN_MAIN" },
    );
    session.lock();
    expect(await handler({ type: "wallet.transactionAlerts" }, extensionSender)).toEqual({
      alerts: [],
      ok: true,
    });
    expect((await activityLog.list())[0]?.failureNotice).toBe("pending");
  });

  test("merges real on-chain history into the feed, deduped against local records", async () => {
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
    const { handler, historyRequests } = makeHarness({ onChainHistory: [chainOnly] });
    await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
        reviewedFee,
        tokenId,
        type: "wallet.transfer",
      },
      extensionSender,
    );
    const idle = (await handler({ type: "wallet.activity" }, extensionSender)) as ActivityResponse;
    expect(idle.activity.map((entry) => entry.hash)).toEqual(["0x7ab"]);
    expect(historyRequests()).toBe(0);

    const response = (await handler(
      { refreshHistory: true, type: "wallet.activity" },
      extensionSender,
    )) as ActivityResponse;
    expect(response.activity.map((entry) => entry.hash)).toEqual(["0xc4a1", "0x7ab"]);
    expect(response.historyUnavailable).toBeUndefined();
    const cached = (await handler({ cached: true, type: "wallet.activity" }, extensionSender)) as {
      activity: readonly ActivityEntry[];
    };
    expect(cached.activity.map((entry) => entry.hash)).toEqual(["0xc4a1", "0x7ab"]);
    expect(historyRequests()).toBe(1);
    await handler({ type: "wallet.activity" }, extensionSender);
    expect(historyRequests()).toBe(1);
    await handler({ refreshHistory: true, type: "wallet.activity" }, extensionSender);
    expect(historyRequests()).toBe(1);
    await handler(
      { forceHistory: true, refreshHistory: true, type: "wallet.activity" },
      extensionSender,
    );
    expect(historyRequests()).toBe(2);
  });

  test("degrades to the local feed with an indicator when history is unreachable", async () => {
    const { handler, historyRequests } = makeHarness({ historyThrows: true });
    await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
        reviewedFee,
        tokenId,
        type: "wallet.transfer",
      },
      extensionSender,
    );
    const response = (await handler(
      { refreshHistory: true, type: "wallet.activity" },
      extensionSender,
    )) as ActivityResponse;
    expect(response.historyUnavailable).toBe(true);
    expect(response.activity[0]?.hash).toBe("0x7ab");
    const retry = (await handler({ type: "wallet.activity" }, extensionSender)) as ActivityResponse;
    expect(retry.historyUnavailable).toBe(true);
    expect(historyRequests()).toBe(1);
  });
});
