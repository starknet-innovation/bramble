/**
 * Wallet operations checks: the pre-sign review carries verification output
 * and fees, transfers are recorded in the activity feed, and the feed
 * refreshes pending statuses per network.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../src/background/messages";
import type { RuntimeSender } from "../../src/background/senders";
import { createUnlockSession } from "../../src/background/session";
import type { TransactionStatusReport } from "../../src/starknet/rpc";
import { type ActivityEntry, createActivityLog } from "../../src/storage/activity-store";
import { createMemoryStore } from "../../src/storage/kv";
import type { AccountRef, Vault } from "../../src/storage/vault-schema";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const vaultPassphrase = "correct horse battery staple";
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const tokenId = `SN_MAIN:ETH:${ETH}`;
const OTHER_ACCOUNT_ID =
  "SN_MAIN:0x9234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const walletStub = {
  async createAccount() {
    return account;
  },
  async addDerivedAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return vault;
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: false,
    };
  },
};

const makeHarness = (options?: {
  readonly balanceThrows?: boolean;
  readonly deployed?: boolean;
  readonly estimateFails?: boolean;
  readonly onChainHistory?: readonly ActivityEntry[];
  readonly historyThrows?: boolean;
  readonly statusReport?: TransactionStatusReport;
  readonly strkBalance?: string;
}) => {
  const history =
    options?.historyThrows || options?.onChainHistory
      ? {
          async getTransactionHistory(): Promise<readonly ActivityEntry[]> {
            if (options.historyThrows) {
              throw new Error("fetch failed");
            }
            return options.onChainHistory ?? [];
          },
        }
      : {};
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  let tick = 0;
  const activity = createActivityLog({
    now: () => {
      tick += 1000;
      return tick;
    },
    store: createMemoryStore(),
  });
  const statusRequests: string[][] = [];
  const handler = createMessageHandler(walletStub, "extension-id", {
    activity,
    // The activity log stamps entries on its own monotonic test clock, so the
    // reconciliation clock reads from the same tick counter — otherwise every
    // recorded transaction looks older than its observation window.
    now: () => tick,
    runtimeRpc: {
      async estimateInvokeFee() {
        if (options?.estimateFails) {
          throw new Error("rpc unavailable");
        }
        return { overallFee: "2500000000000000", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return options?.deployed ?? true;
      },
      async getNftOwner() {
        return "0x0";
      },
      async getTokenBalances({ tokens }) {
        if (options?.balanceThrows) {
          throw new Error("balance unavailable");
        }
        if (options?.strkBalance === undefined) {
          return [];
        }
        return tokens.map((token) => ({
          ...token,
          balance: options.strkBalance ?? "0",
          formatted: options.strkBalance ?? "0",
        }));
      },
      async getTokenMetadata() {
        return { decimals: 18, name: "Token", symbol: "TKN" };
      },
      async getTransactionStatuses({ hashes }) {
        statusRequests.push([...hashes]);
        return Object.fromEntries(
          hashes.map((hash) => [
            hash,
            options?.statusReport ?? { finalizedOnL1: false, found: true, status: "accepted" },
          ]),
        );
      },
      async submitDeclareTransaction() {
        return { classHash: "0x1", transactionHash: "0x1" };
      },
      async submitAccountDeployment() {
        return { transactionHash: "0x7de" };
      },
      async submitErc20Transfer() {
        return {
          call: {
            calldata: ["0x777", "1500000000000000000", "0"],
            contractAddress: ETH,
            entrypoint: "transfer",
          },
          transactionHash: "0x7ab",
        };
      },
      async submitInvokeTransaction() {
        return { calls: [], transactionHash: "0x7cd" };
      },
      ...history,
    },
    session,
  });
  return { activity, handler, session, statusRequests };
};

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

  test("review reports required deployment instead of a fee when undeployed", async () => {
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
      review: { fee: null, feeEstimateFailed: false, requiresDeployment: true },
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

  // Fee-affordability guard (issue 191): the review compares the estimate
  // against the account's STRK balance via the shared predicate. Warn-only —
  // nothing here changes what is submittable — and fail-open on missing data.
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
      accountId: account.id,
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

  // A pre-confirmed transaction reaches the feed as its own provisional status
  // rather than being flattened into accepted or left reading as pending.
  test("surfaces a pre-confirmed transaction as provisional in the feed", async () => {
    const { handler } = makeHarness({
      statusReport: { finalizedOnL1: false, found: true, status: "preconfirmed" },
    });
    await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
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

  // The late-failure channel: a transaction that was pre-confirmed and then
  // reverted owes the user one notice, delivered on the panel's next poll.
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
    const { handler } = makeHarness({ onChainHistory: [chainOnly] });
    await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
        tokenId,
        type: "wallet.transfer",
      },
      extensionSender,
    );

    const response = (await handler({ type: "wallet.activity" }, extensionSender)) as {
      activity: readonly ActivityEntry[];
      historyUnavailable?: boolean;
    };
    // Chain history (newest) appears above the locally-submitted transfer, and
    // there is no duplicate or degraded indicator.
    expect(response.activity.map((entry) => entry.hash)).toEqual(["0xc4a1", "0x7ab"]);
    expect(response.historyUnavailable).toBeUndefined();
  });

  test("degrades to the local feed with an indicator when history is unreachable", async () => {
    const { handler } = makeHarness({ historyThrows: true });
    await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
        tokenId,
        type: "wallet.transfer",
      },
      extensionSender,
    );

    const response = (await handler({ type: "wallet.activity" }, extensionSender)) as {
      activity: readonly ActivityEntry[];
      historyUnavailable?: boolean;
    };
    expect(response.historyUnavailable).toBe(true);
    expect(response.activity).toHaveLength(1);
    expect(response.activity[0]?.hash).toBe("0x7ab");
  });
});
