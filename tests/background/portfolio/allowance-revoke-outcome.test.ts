/**
 * Issue 647: a submitted revoke stores its own transaction hash, and the
 * allowance manager settles the pending mark on that transaction's outcome as
 * the wallet's activity reconciliation observed it, through the real message
 * handler. A revoke the chain rejected or reverted stops showing as on its
 * way and leaves the grant listed and revokable; one the chain accepted is
 * never dropped on its outcome alone: with no allowance reading it keeps the
 * mark until a reading settles it; one still pending keeps the mark.
 */
import { describe, expect, test } from "bun:test";
import { type ActivityStatus, memoryActivityLog } from "@bramble/transactions/activity";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId, reviewedApprovalFee } from "../../support/held";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
// Full-length felt so composed allowance ids exercise their real ~205-character
// length; a short stub spender here once masked an id-length cap that rejected
// revoking most genuine allowances.
const SPENDER = `0x7${"5".repeat(62)}`;
const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const vaultPassphrase = "correct horse battery staple";
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://dapp.example/app" };

const walletStub = {
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "unused";
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

const APPROVE_HASH = "0x1001";
const REVOKE_HASH = "0x1002";

type TrackedReading = { readonly amount: string; readonly id: string };
type Listing = { readonly allowances: readonly { readonly id: string; revoking?: true }[] };

const makeHarness = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const allowanceStore = memoryAllowanceStore();
  const activity = memoryActivityLog(() => 1);
  const hashes = [APPROVE_HASH, REVOKE_HASH];
  // What the node answers for `allowance(owner, spender)`; none by default.
  const node: { read: (ids: readonly string[]) => Promise<readonly TrackedReading[]> } = {
    read: async () => [],
  };
  const handler = createMessageHandler(walletStub, testExtension, {
    activity,
    allowanceStore,
    runtimeRpc: makeRuntimeRpc({
      async getTrackedAllowances(input) {
        return node.read(input.pairs.map((pair) => pair.id));
      },
      async submitInvokeTransaction(input) {
        return { calls: input.calls, transactionHash: hashes.shift() ?? "0x1fff" };
      },
    }),
    session,
  });
  const list = async (): Promise<Listing> =>
    (await handler({ type: "wallet.allowances" }, extensionSender)) as Listing;
  return { activity, allowanceStore, handler, list, node };
};

// Grants through the dapp invoke path, then revokes the grant from the
// manager, exactly as the panel does.
const grantThenRevoke = async (harness: ReturnType<typeof makeHarness>): Promise<string> => {
  const { handler, list } = harness;
  const held = handler(
    {
      calls: [{ calldata: [SPENDER, "1000", "0"], contractAddress: TOKEN, entrypoint: "approve" }],
      origin: "https://dapp.example",
      type: "wallet.addInvokeTransaction",
    },
    contentSender,
  );
  await flushHeld();
  const approval = await latestApprovalId(handler, extensionSender);
  const reviewedFee = await reviewedApprovalFee(handler, extensionSender, approval);
  await handler({ id: approval, reviewedFee, type: "wallet.approveOrigin" }, extensionSender);
  await held;
  const id = (await list()).allowances[0]?.id ?? "";
  await expect(
    handler(
      { id, reviewedFee: { overallFee: "1", unit: "FRI" }, type: "wallet.revokeAllowance" },
      extensionSender,
    ),
  ).resolves.toEqual({ ok: true, transactionHash: REVOKE_HASH });
  return id;
};

const settle = (harness: ReturnType<typeof makeHarness>, status: ActivityStatus) =>
  harness.activity.updateStatuses(
    { [REVOKE_HASH]: { status } },
    { accountId: account.id, networkId: "SN_MAIN" },
  );

describe("issue 647: a revoke settles on its own transaction's outcome", () => {
  test("the stored revoke records the hash of the transaction that carried it", async () => {
    const harness = makeHarness();
    await grantThenRevoke(harness);
    expect(await harness.allowanceStore.list()).toMatchObject([
      { amount: "1000", revokeHash: REVOKE_HASH, revoking: true },
    ]);
    // The hash is bookkeeping: the manager's rows never carry it.
    expect((await harness.list()).allowances[0]).not.toHaveProperty("revokeHash");
  });

  test.each(["reverted", "rejected"] as const)(
    "a %s revoke clears the pending mark and keeps the grant listed",
    async (status) => {
      const harness = makeHarness();
      const id = await grantThenRevoke(harness);
      await settle(harness, status);

      const [row, ...rest] = (await harness.list()).allowances;
      expect(rest).toEqual([]);
      expect(row).toMatchObject({ amount: "1000", id });
      expect(row?.revoking).toBeUndefined();
      const [stored] = await harness.allowanceStore.list();
      expect(stored?.revoking).toBeUndefined();
      expect(stored?.revokeHash).toBeUndefined();
    },
  );

  test("an accepted revoke with no chain reading keeps the row and its mark", async () => {
    const harness = makeHarness();
    const id = await grantThenRevoke(harness);
    await settle(harness, "accepted");

    expect((await harness.list()).allowances).toMatchObject([{ id, revoking: true }]);
    expect(await harness.allowanceStore.list()).toHaveLength(1);
  });

  test.each(["pending", "preconfirmed"] as const)(
    "a %s revoke keeps the pending mark",
    async (status) => {
      const harness = makeHarness();
      const id = await grantThenRevoke(harness);
      await settle(harness, status);

      expect((await harness.list()).allowances).toMatchObject([{ id, revoking: true }]);
    },
  );

  test("outcomes are read before the allowance readings", async () => {
    const harness = makeHarness();
    const id = await grantThenRevoke(harness);
    // The reconciler sees the revoke execute while the node is answering with
    // the figure it held before: that reading must not be paired with it.
    harness.node.read = async (ids) => {
      await settle(harness, "accepted");
      return ids.map((pairId) => ({ amount: "1000", id: pairId }));
    };
    await harness.list();
    expect(await harness.allowanceStore.list()).toMatchObject([
      { id, revokeHash: REVOKE_HASH, revoking: true },
    ]);
  });

  test("accepted, a stale non-zero reading, then zero: the row goes", async () => {
    const harness = makeHarness();
    const id = await grantThenRevoke(harness);
    await settle(harness, "accepted");
    harness.node.read = async () => [{ amount: "1000", id }];
    expect((await harness.list()).allowances).toMatchObject([{ id, revoking: true }]);
    harness.node.read = async () => [{ amount: "0", id }];
    expect((await harness.list()).allowances).toEqual([]);
    expect(await harness.allowanceStore.list()).toEqual([]);
  });

  test("accepted with a genuine re-grant: the row shows the re-grant amount", async () => {
    const harness = makeHarness();
    const id = await grantThenRevoke(harness);
    await settle(harness, "accepted");
    harness.node.read = async () => [{ amount: "250", id }];
    expect((await harness.list()).allowances).toMatchObject([{ amount: "250", id }]);
    // Still "250" when the next read fails.
    harness.node.read = async () => [];
    expect((await harness.list()).allowances).toMatchObject([{ amount: "250", id }]);
  });
});
