/**
 * An explicit `wallet.lock` must revoke a Ledger device sign that is parked for
 * the side panel, so a request authorized under the now-defunct unlock can never
 * be completed and broadcast afterward. Driven end-to-end through the dispatcher
 * with the DEFAULT (production-wired) sign queue — the queue reads the session
 * generation, and the lock handler rejects every parked request:
 *   - lock while a dapp invoke's device sign is parked settles the held dapp
 *     waiter to a "wallet locked" error, removes the approval, and broadcasts
 *     nothing;
 *   - a panel completion arriving after the lock finds no pending sign and still
 *     broadcasts nothing;
 *   - a normal unlock -> sign -> complete round-trip is unaffected;
 *   - lock-then-reunlock leaves no stale parked request behind.
 * The device is a fake signer (a starknet.js key) — no hardware or transport.
 */
import { describe, expect, test } from "bun:test";
import { ec } from "starknet";
import { setApprovalNotifier } from "../../src/background/approval-notifier";
import { createMessageHandler } from "../../src/background/messages";
import type { RuntimeResponse } from "../../src/background/runtime-types";
import type { RuntimeSender } from "../../src/background/senders";
import { createUnlockSession } from "../../src/background/session";
import { ledgerAccountPath } from "../../src/starknet/ledger-path";
import type { LedgerAccountRef, Vault } from "../../src/storage/vault-schema";
import { waitForPendingApprovals } from "../support/held";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const { starkCurve } = ec;
const PASSPHRASE = "correct horse battery staple";
const ORIGIN = "https://dapp.example";
const LEDGER_KEY = "0x1234567890abcdef";
const publicKeyX = starkCurve.getStarkKey(LEDGER_KEY);
const INVOKE_HASH = "0x1e240";

const ledgerAccount: LedgerAccountRef = {
  address: "0xabc111111",
  classHash: "0x111111",
  derivation: {
    accountIndex: 2,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: ledgerAccountPath(2),
  },
  id: "SN_MAIN:0xabc111111",
  networkId: "SN_MAIN",
  publicKeyX,
};

const vault = {
  accounts: [ledgerAccount],
  activeAccountId: ledgerAccount.id,
} as unknown as Vault;

const content: RuntimeSender = { id: "ext", url: `${ORIGIN}/app` };
const page: RuntimeSender = { id: "ext", url: "chrome-extension://ext/sidepanel.html" };

const walletStub = {
  async addDerivedAccount() {
    return ledgerAccount;
  },
  async createAccount() {
    return ledgerAccount;
  },
  async ensureNetworkAccount() {
    return ledgerAccount;
  },
  async getGrantedAccounts() {
    return [ledgerAccount];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return [ledgerAccount];
  },
  async readVault() {
    return vault;
  },
  async setActiveAccount() {
    return ledgerAccount;
  },
  async signHash(): Promise<never> {
    throw new Error("vault signHash must not be reached for a Ledger account");
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: ledgerAccount.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

const invokeMessage = {
  calls: [{ calldata: [], contractAddress: "0x1", entrypoint: "transfer" }],
  origin: ORIGIN,
  type: "wallet.addInvokeTransaction" as const,
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type PendingList = { ok: true; pending: { id: string }[] };
const isPendingList = (value: RuntimeResponse): value is RuntimeResponse & PendingList =>
  "pending" in value && "ok" in value && value.ok === true;

// Builds a dispatcher with the default (production-wired) queue and a submit
// that drives the injected signHash — parking a device sign — before it would
// broadcast, so a rejected/aborted sign leaves `broadcast` false.
const makeHarness = () => {
  setApprovalNotifier(() => undefined);
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  const state = { broadcast: false };
  const handler = createMessageHandler(walletStub, "ext", {
    runtimeRpc: makeRuntimeRpc({
      async submitInvokeTransaction(input) {
        // Parks the device sign; only reached past here once it resolves.
        await input.signHash(INVOKE_HASH);
        state.broadcast = true;
        return { calls: input.calls, transactionHash: "0xbroadcast" };
      },
    }),
    session,
  });
  return { handler, session, state };
};

// Polls the pending device signs until one is parked, returning its queue id.
const waitForParkedSign = async (
  handler: ReturnType<typeof createMessageHandler>,
): Promise<string> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const listed = await handler({ type: "wallet.ledgerSignPending" }, page);
    if (isPendingList(listed) && listed.pending.length > 0) {
      return listed.pending[0]?.id ?? "";
    }
    await flush();
  }
  throw new Error("device sign never parked");
};

// Fires a dapp invoke, approves it (without awaiting — the executor parks on the
// device), and waits until the device sign is parked. Returns the held promises.
const parkInvokeSign = async (handler: ReturnType<typeof createMessageHandler>) => {
  const held = handler(invokeMessage, content);
  const listed = await waitForPendingApprovals<{ id: string }>(handler, page);
  const approvalId = listed[0]?.id ?? "";
  const approvePromise = handler({ id: approvalId, type: "wallet.approveOrigin" }, page);
  const signId = await waitForParkedSign(handler);
  return { approvePromise, held, signId };
};

describe("wallet.lock revokes an in-flight Ledger sign", () => {
  test("lock while parked settles the held dapp waiter, removes the approval, broadcasts nothing", async () => {
    const { handler, state } = makeHarness();
    const { approvePromise, held } = await parkInvokeSign(handler);

    // A device sign is parked and nothing has broadcast yet.
    expect(state.broadcast).toBe(false);

    await handler({ type: "wallet.lock" }, page);

    expect(await held).toEqual({ error: "wallet locked" });
    expect(await approvePromise).toEqual({ error: "wallet locked" });
    // Nothing broadcast, the parked sign is gone, and the approval is cleared.
    expect(state.broadcast).toBe(false);
    const signs = await handler({ type: "wallet.ledgerSignPending" }, page);
    expect(isPendingList(signs) ? signs.pending : ["!"]).toHaveLength(0);
    const approvals = await handler({ type: "wallet.pendingApprovals" }, page);
    expect(isPendingList(approvals) ? approvals.pending : ["!"]).toHaveLength(0);
  });

  test("a device completion arriving after a lock is rejected and broadcasts nothing", async () => {
    const { handler, state } = makeHarness();
    const { approvePromise, held, signId } = await parkInvokeSign(handler);

    await handler({ type: "wallet.lock" }, page);
    expect(await held).toEqual({ error: "wallet locked" });
    await approvePromise;

    // The panel completes the (now-defunct) sign after the lock: no pending
    // request remains to settle, so nothing is verified or broadcast.
    const sig = starkCurve.sign(INVOKE_HASH, LEDGER_KEY);
    const late = await handler(
      {
        id: signId,
        r: `0x${sig.r.toString(16)}`,
        s: `0x${sig.s.toString(16)}`,
        type: "wallet.completeLedgerSign",
      },
      page,
    );
    expect(late).toEqual({ error: "no pending ledger sign for id" });
    expect(state.broadcast).toBe(false);
  });

  test("a normal unlock -> sign -> complete round-trip still broadcasts", async () => {
    const { handler, state } = makeHarness();
    const { approvePromise, held, signId } = await parkInvokeSign(handler);

    // The panel returns a device signature that verifies; no lock intervened.
    const sig = starkCurve.sign(INVOKE_HASH, LEDGER_KEY);
    const settled = await handler(
      {
        id: signId,
        r: `0x${sig.r.toString(16)}`,
        s: `0x${sig.s.toString(16)}`,
        type: "wallet.completeLedgerSign",
      },
      page,
    );
    expect(settled).toEqual({ ok: true });
    // The transaction hash reaches the dapp through its held request channel;
    // the approve page response just reports the drained pending queue.
    expect(await held).toEqual({ ok: true, transactionHash: "0xbroadcast" });
    expect(await approvePromise).toEqual({ ok: true, pending: [] });
    expect(state.broadcast).toBe(true);
  });

  test("lock then re-unlock leaves no stale parked request", async () => {
    const { handler, session } = makeHarness();
    const { approvePromise, held } = await parkInvokeSign(handler);

    await handler({ type: "wallet.lock" }, page);
    await held;
    await approvePromise;

    session.unlock(PASSPHRASE);
    const signs = await handler({ type: "wallet.ledgerSignPending" }, page);
    expect(isPendingList(signs) ? signs.pending : ["!"]).toHaveLength(0);
  });
});
