/**
 * Per-transaction approval gate (A-H1): a connected dapp's addInvokeTransaction
 * no longer auto-submits. It is decoded and queued as an "invoke" approval; the
 * held calls run only when the user approves in the side panel, and are dropped
 * on deny. Blocked or unconnected origins never reach the queue.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../src/background/approvals";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeRpc } from "../src/background/runtime-rpc";
import { unavailablePreferencesStore } from "../src/background/runtime-state";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { InvokeInput } from "../src/starknet/rpc";
import { memoryActivityLog } from "../src/storage/activity-store";
import type { AccountRef } from "../src/storage/vault-schema";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vaultPassphrase = "correct horse battery staple";
const origin = "https://dapp.example";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const call = { calldata: ["0x5", "1000", "0"], contractAddress: "0x123", entrypoint: "transfer" };

const walletStub = (connected: readonly AccountRef[]) => ({
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts(target: string) {
    return target === origin ? connected : [];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return connected;
  },
  async readVault() {
    return {
      accounts: [account],
      activeAccountId: account.id,
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin }],
      schemaVersion: 2 as const,
      signingKeys: [{ accountId: account.id, privateKey: "0x123456" }],
    };
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
      ready: true,
    };
  },
});

const makeHarness = (connected: readonly AccountRef[] = [account]) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const approvals = createApprovalQueue();
  const activity = memoryActivityLog();
  const invoked: InvokeInput[] = [];
  const rpc = {
    async submitInvokeTransaction(input: InvokeInput) {
      invoked.push(input);
      return { calls: input.calls, transactionHash: "0x7cd" };
    },
  } as unknown as RuntimeRpc;
  const handler = createMessageHandler(
    walletStub(connected),
    "extension-id",
    session,
    approvals,
    unavailablePreferencesStore,
    rpc,
    activity,
  );
  return { activity, handler, invoked };
};

const invokeMessage = (target = origin) => ({
  calls: [call],
  origin: target,
  type: "wallet.addInvokeTransaction" as const,
});

describe("per-transaction invoke approval (A-H1)", () => {
  test("queues a connected dapp invoke instead of submitting it", async () => {
    const { handler, invoked } = makeHarness();

    const response = await handler(invokeMessage(), contentSender);

    expect(response).toMatchObject({ ok: false, pending: { kind: "invoke", origin } });
    const pending = (response as { pending: { summaries?: readonly string[] } }).pending;
    expect(pending.summaries?.length).toBe(1);
    expect(invoked).toHaveLength(0);
  });

  test("submits the held calls only after the user approves", async () => {
    const { activity, handler, invoked } = makeHarness();

    const queued = await handler(invokeMessage(), contentSender);
    const id = (queued as { pending: { id: string } }).pending.id;

    const listed = await handler({ type: "wallet.pendingApprovals" }, extensionSender);
    expect((listed as { pending: readonly { kind?: string }[] }).pending[0]?.kind).toBe("invoke");

    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.account).toEqual(account);
    const recorded = await activity.list();
    expect(recorded[0]?.hash).toBe("0x7cd");
  });

  test("drops the held calls when the user denies", async () => {
    const { handler, invoked } = makeHarness();

    const queued = await handler(invokeMessage(), contentSender);
    const id = (queued as { pending: { id: string } }).pending.id;

    await expect(handler({ id, type: "wallet.denyOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    expect(invoked).toHaveLength(0);
  });

  test("rejects an invoke from an unconnected origin without queueing", async () => {
    const { handler, invoked } = makeHarness([]);

    await expect(handler(invokeMessage(), contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
    expect(invoked).toHaveLength(0);
  });

  test("rejects an invoke from a blocklisted origin", async () => {
    const { handler, invoked } = makeHarness();
    const blockedOrigin = "https://starknet-airdrop.com";

    await expect(
      handler(invokeMessage(blockedOrigin), {
        id: "extension-id",
        url: `${blockedOrigin}/app`,
      }),
    ).resolves.toEqual({ error: "origin blocked" });
    expect(invoked).toHaveLength(0);
  });
});
