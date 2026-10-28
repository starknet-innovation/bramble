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
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { postDeploymentFailure } from "@bramble/starknet/rpc-submit";
import { type ActivityStatus, memoryActivityLog } from "@bramble/transactions/activity";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { readSubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
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

const OTHER_ACCOUNT_ID = `SN_MAIN:${account.address.slice(0, -1)}f`;
const APPROVE_HASH = "0x1001";
const REVOKE_HASH = "0x1002";

type TrackedReading = { readonly amount: string; readonly id: string };
type Listing = { readonly allowances: readonly { readonly id: string; revoking?: true }[] };

type InvokeInput = Parameters<
  NonNullable<NonNullable<Parameters<typeof makeRuntimeRpc>[0]>["submitInvokeTransaction"]>
>[0];

const makeHarness = (lostRevoke?: (input: InvokeInput) => Promise<never>) => {
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
        if (lostRevoke && hashes.length === 1) return lostRevoke(input);
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

  test("a chain-discovered row with the revoke's hash is not an outcome", async () => {
    const harness = makeHarness();
    const id = await grantThenRevoke(harness);
    const scope = { accountId: account.id, networkId: "SN_MAIN" as const };
    // The same hash as a row this wallet did not record (no `origin`), reverted.
    const rows = (await harness.activity.list()).map((entry) => {
      if (entry.hash !== REVOKE_HASH) return entry;
      const { origin: _wallet, ...discovered } = entry;
      return { ...discovered, status: "reverted" as const };
    });
    await harness.activity.replaceScope?.(rows, scope);

    expect((await harness.list()).allowances).toMatchObject([{ id, revoking: true }]);
  });

  test("a wallet row for the hash in another scope is not an outcome", async () => {
    const harness = makeHarness();
    const id = await grantThenRevoke(harness);
    await harness.activity.record({
      accountId: OTHER_ACCOUNT_ID,
      hash: REVOKE_HASH,
      kind: "invoke",
      networkId: "SN_MAIN",
      origin: "wallet",
      summary: "Other scope",
    });
    await harness.activity.updateStatuses(
      { [REVOKE_HASH]: { status: "reverted" } },
      { accountId: OTHER_ACCOUNT_ID, networkId: "SN_MAIN" },
    );

    expect((await harness.list()).allowances).toMatchObject([{ id, revoking: true }]);
  });

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

// Audit L3: a revoke whose reply was lost may already be on chain. It keeps
// its pending row and revoke mark under the signed hash, so the manager shows
// it on its way and Activity has something to settle, and the panel is told
// the outcome is unknown.
describe("a revoke with a lost reply", () => {
  test("records the signed hash as pending and answers status unknown", async () => {
    const harness = makeHarness(async (input) => {
      await input.onSigned?.({
        nonce: "0x1",
        senderAddress: account.address,
        transactionHash: REVOKE_HASH,
      });
      throw new IndeterminateRpcWriteError("Transaction submission status is unknown.");
    });
    const { handler, list } = harness;
    const held = handler(
      {
        calls: [
          { calldata: [SPENDER, "1000", "0"], contractAddress: TOKEN, entrypoint: "approve" },
        ],
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

    const response = await handler(
      { id, reviewedFee: { overallFee: "1", unit: "FRI" }, type: "wallet.revokeAllowance" },
      extensionSender,
    );

    expect(readSubmissionUnknownError(response)?.transactionHash).toBe(REVOKE_HASH);
    const rows = await harness.activity.list();
    expect(rows.find((row) => row.hash === REVOKE_HASH)?.status).toBe("pending");
    expect(await harness.allowanceStore.list()).toMatchObject([
      { id, revokeHash: REVOKE_HASH, revoking: true },
    ]);
  });
});

// mc-wallet 719: a revoke from an undeployed account deploys it first. That
// accepted deployment is recorded beside the revoke, and still recorded when
// the revoke after it is refused or loses its reply, since its fee is spent.
describe("a revoke that deploys the account first", () => {
  const DEPLOY = "0xd3a1";

  type Submitted = Awaited<
    ReturnType<
      NonNullable<NonNullable<Parameters<typeof makeRuntimeRpc>[0]>["submitInvokeTransaction"]>
    >
  >;
  const revokeWith = async (revokeSubmit: (input: InvokeInput) => Promise<Submitted>) => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const activity = memoryActivityLog(() => 1);
    let calls = 0;
    const handler = createMessageHandler(walletStub, testExtension, {
      activity,
      allowanceStore: memoryAllowanceStore(),
      runtimeRpc: makeRuntimeRpc({
        async getTrackedAllowances() {
          return [];
        },
        async submitInvokeTransaction(input) {
          calls += 1;
          // The first submission is the dapp approve that creates the grant.
          return calls === 1
            ? { calls: input.calls, transactionHash: APPROVE_HASH }
            : revokeSubmit(input);
        },
      }),
      session,
    });
    const held = handler(
      {
        calls: [
          { calldata: [SPENDER, "1000", "0"], contractAddress: TOKEN, entrypoint: "approve" },
        ],
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
    const listing = (await handler({ type: "wallet.allowances" }, extensionSender)) as Listing;
    const response = await handler(
      {
        id: listing.allowances[0]?.id ?? "",
        reviewedFee: { overallFee: "1", unit: "FRI" },
        type: "wallet.revokeAllowance",
      },
      extensionSender,
    );
    const rows = (await activity.list()).map((row) => [row.kind, row.hash]);
    return { response, rows };
  };

  test("records the deployment beside the revoke", async () => {
    const { response, rows } = await revokeWith(async (input) => ({
      calls: input.calls,
      deploymentTransactionHash: DEPLOY,
      transactionHash: REVOKE_HASH,
    }));
    expect(response).toEqual({ ok: true, transactionHash: REVOKE_HASH });
    expect(rows).toContainEqual(["deploy", DEPLOY]);
    expect(rows).toContainEqual(["invoke", REVOKE_HASH]);
  });

  test("still records the deployment when the revoke after it is refused", async () => {
    const { response, rows } = await revokeWith(async () => {
      throw postDeploymentFailure(DEPLOY, new Error("invoke rejected"));
    });
    expect(response).toHaveProperty("error");
    expect(rows).toContainEqual(["deploy", DEPLOY]);
    expect(rows).not.toContainEqual(["invoke", REVOKE_HASH]);
  });

  test("still records the deployment when the reply is lost, and stays unknown", async () => {
    const { response, rows } = await revokeWith(async (input) => {
      await input.onSigned?.({
        nonce: "0x1",
        senderAddress: account.address,
        transactionHash: REVOKE_HASH,
      });
      throw postDeploymentFailure(DEPLOY, new IndeterminateRpcWriteError("reply lost"));
    });
    expect(readSubmissionUnknownError(response)?.transactionHash).toBe(REVOKE_HASH);
    expect(rows).toContainEqual(["deploy", DEPLOY]);
    expect(rows).toContainEqual(["invoke", REVOKE_HASH]);
  });

  test("records no deployment when none was sent", async () => {
    const { rows } = await revokeWith(async (input) => ({
      calls: input.calls,
      transactionHash: REVOKE_HASH,
    }));
    expect(rows.some(([kind]) => kind === "deploy")).toBe(false);
  });
});
