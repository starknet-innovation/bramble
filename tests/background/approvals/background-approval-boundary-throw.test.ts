/**
 * Shared fail-closed settlement boundary in applyApproveDecision. The per-kind
 * executors already turn a handled failure into a returned `{ error }`, but a
 * *thrown* error from approval validation or an applier/executor (here: a vault
 * read on the approve path only) must not escape settlement. For invoke,
 * declare, and sign-typed-data this asserts, end-to-end through the dispatcher,
 * that a throw:
 *   - settles the held dapp waiter with a curated error (no hang or leak),
 *   - removes the stranded approval (mirrors normal completion),
 *   - submits nothing / returns no signature,
 *   - surfaces no unhandled rejection (the approve response is the same error).
 * A returned `{ error }` from a per-executor catch flows through the normal
 * settle path instead — the boundary catch fires only on an actual throw, so it
 * never double-settles a result that already settled below.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@mc-wallet/core/errors";
import type { Vault } from "@mc-wallet/vault/schema";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { setApprovalNotifier } from "../../../apps/extension/src/background/approvals/approval-notifier";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { reviewedApprovalFee, waitForPendingApprovals } from "../../support/held";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const PASSPHRASE = "correct horse battery staple";
const ORIGIN = "https://dapp.example";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const vault = {
  accounts: [account],
  accountSecrets: [],
  activeAccountId: account.id,
  mnemonic: null,
  originGrants: [{ accountIds: [account.id], origin: ORIGIN }],
  schemaVersion: 4,
  signingKeys: [{ accountId: account.id, privateKey: "0x7e5" }],
} as unknown as Vault;

// A well-formed SNIP-12 typed message that hashes cleanly for the account.
const TYPED_DATA = {
  domain: { chainId: "0x534e5f4d41494e", name: "Example", revision: "1", version: "1" },
  message: { contents: "hello" },
  primaryType: "Mail",
  types: {
    Mail: [{ name: "contents", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "felt" },
      { name: "version", type: "felt" },
      { name: "chainId", type: "felt" },
    ],
  },
};

const content: RuntimeSender = { id: "ext", url: `${ORIGIN}/app` };
const page: RuntimeSender = { id: "ext", url: "chrome-extension://ext/sidepanel.html" };

// A vault stub whose getGrantedAccounts is *armed* to throw a WalletError from
// deeper than any executor try/catch. It succeeds on the dapp-request path (so
// the approval queues) and throws once armed, i.e. on the approve/execute path.
const makeWallet = (control: { throwOnGrant: boolean }) => ({
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
    if (control.throwOnGrant) {
      throw new WalletError("vault read failed");
    }
    return [account];
  },
  async generateMnemonic() {
    return "phrase";
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
      ready: true,
    };
  },
});

type PendingList = { pending: { id: string }[] };

const pendingIds = async (
  handler: ReturnType<typeof createMessageHandler>,
): Promise<{ id: string }[]> => {
  const listed = (await handler(
    { type: "wallet.pendingApprovals" },
    page,
  )) as unknown as PendingList;
  return listed.pending;
};

// Drives one dapp request to a held waiter, arms the vault throw, approves, and
// returns the settled held result, the approve response, whether a submit was
// attempted, and the post-approve pending count.
const driveThrow = async (dappMessage: Record<string, unknown>) => {
  setApprovalNotifier(() => undefined);
  const control = { throwOnGrant: false };
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  let submitted = false;
  const handler = createMessageHandler(makeWallet(control), "ext", {
    runtimeRpc: makeRuntimeRpc({
      async submitDeclareTransaction() {
        submitted = true;
        return { classHash: "0x1", transactionHash: "0x1" };
      },
      async submitInvokeTransaction(input) {
        submitted = true;
        return { calls: input.calls, transactionHash: "0x7cd" };
      },
    }),
    session,
  });

  let settled = false;
  const held = handler(dappMessage, content).then((response) => {
    settled = true;
    return response;
  });
  const before = await waitForPendingApprovals<{ id: string }>(handler, page);
  const id = before[0]?.id ?? "";
  const heldBeforeApprove = settled;
  const reviewedFee =
    dappMessage["type"] === "wallet.addInvokeTransaction" ||
    dappMessage["type"] === "wallet.addDeclareTransaction"
      ? await reviewedApprovalFee(handler, page, id)
      : undefined;

  // Arm the throw so it fires from inside the executor, not the request path.
  control.throwOnGrant = true;
  const decision = await handler(
    { id, ...(reviewedFee ? { reviewedFee } : {}), type: "wallet.approveOrigin" },
    page,
  );
  const result = await held;
  const after = await pendingIds(handler);
  return { after, before, decision, heldBeforeApprove, result, submitted };
};

describe("shared approval-decision settlement boundary on a thrown dependency", () => {
  test("invoke: a thrown dependency settles the held waiter and removes the approval", async () => {
    const outcome = await driveThrow({
      calls: [{ calldata: [], contractAddress: "0x1", entrypoint: "transfer" }],
      origin: ORIGIN,
      type: "wallet.addInvokeTransaction",
    });

    expect(outcome.heldBeforeApprove).toBe(false);
    expect(outcome.before).toHaveLength(1);
    // Held dapp waiter settles to a curated error — no hang or detail leak.
    expect(outcome.result).toEqual({ error: "approval execution failed" });
    // The approve response surfaces the same error rather than a stale ok.
    expect(outcome.decision).toEqual({ error: "approval execution failed" });
    // Approval removed exactly as a normal completion removes it.
    expect(outcome.after).toHaveLength(0);
    // Nothing submitted on the failing path.
    expect(outcome.submitted).toBe(false);
  });

  test("declare: a thrown dependency settles the held waiter and removes the approval", async () => {
    const outcome = await driveThrow({
      declare: {
        classHash: "0x5abc",
        compiledClassHash: "0x6def",
        contractClass: { entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] },
      },
      origin: ORIGIN,
      type: "wallet.addDeclareTransaction",
    });

    expect(outcome.before).toHaveLength(1);
    expect(outcome.result).toEqual({ error: "approval execution failed" });
    expect(outcome.decision).toEqual({ error: "approval execution failed" });
    expect(outcome.after).toHaveLength(0);
    expect(outcome.submitted).toBe(false);
  });

  test("sign-typed-data: a thrown dependency settles the held waiter and removes the approval", async () => {
    const outcome = await driveThrow({
      origin: ORIGIN,
      type: "wallet.signTypedData",
      typedData: TYPED_DATA,
    });

    expect(outcome.before).toHaveLength(1);
    expect(outcome.result).toEqual({ error: "approval execution failed" });
    // No signature is returned to the dapp on the failing path.
    expect("signature" in (outcome.result as object)).toBe(false);
    expect(outcome.decision).toEqual({ error: "approval execution failed" });
    expect(outcome.after).toHaveLength(0);
  });
});
