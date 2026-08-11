/**
 * Per-transaction approval gate (A-H1): a connected dapp's addInvokeTransaction
 * no longer auto-submits. It is decoded and queued as an "invoke" approval; the
 * held calls run only when the user approves in the side panel, and are dropped
 * on deny. Blocked or unconnected origins never reach the queue.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@mc-wallet/core/errors";
import { defaultWalletPreferences, type WalletPreferences } from "@mc-wallet/settings/preferences";
import type { InvokeInput } from "@mc-wallet/starknet/rpc";
import { memoryActivityLog } from "@mc-wallet/transactions/activity";
import { verifyCalls } from "@mc-wallet/transactions/verify";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { flushHeld, latestApprovalId, waitForPendingApprovals } from "../../support/held";
import {
  invokeAccount as account,
  invokeContentSender as contentSender,
  invokeExtensionSender as extensionSender,
  fixedInvokePreferences as fixedPreferencesStore,
  invokeMessage,
  makeInvokeHarness as makeHarness,
  invokeOrigin as origin,
  invokeVaultPassphrase as vaultPassphrase,
  invokeWalletStub as walletStub,
} from "../../support/invoke-approval-harness";

describe("per-transaction invoke approval (A-H1)", () => {
  test("queues a connected dapp invoke instead of submitting it", async () => {
    const { handler, invoked } = makeHarness();

    // The invoke holds until a decision; inspect the queued approval, then deny
    // so the held request settles and nothing dangles.
    const held = handler(invokeMessage(), contentSender);
    const pending = (
      await waitForPendingApprovals<{
        id: string;
        kind?: string;
        origin?: string;
        summaries?: readonly string[];
      }>(handler, extensionSender)
    ).at(-1);
    expect(pending).toMatchObject({ kind: "invoke", origin });
    expect(pending?.summaries?.length).toBe(1);
    expect(invoked).toHaveLength(0);

    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("submits the held calls only after the user approves", async () => {
    const { activity, handler, invoked } = makeHarness();

    const held = handler(invokeMessage(), contentSender);
    const pending = await waitForPendingApprovals<{ id: string; kind?: string }>(
      handler,
      extensionSender,
    );
    expect(pending[0]?.kind).toBe("invoke");

    const id = await latestApprovalId(handler, extensionSender);
    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    await expect(held).resolves.toEqual({ ok: true, transactionHash: "0x7cd" });
    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.account).toEqual(account);
    const recorded = await activity.list();
    expect(recorded[0]?.hash).toBe("0x7cd");
  });

  test("drops the held calls when the user denies", async () => {
    const { handler, invoked } = makeHarness();

    const held = handler(invokeMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    await expect(handler({ id, type: "wallet.denyOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    await expect(held).resolves.toEqual({ error: "request rejected" });
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

// A harness whose submit drives the injected signer before broadcasting, and
// whose signer throws — standing in for a Ledger device rejection/timeout/
// verify-failure. Exercises the end-to-end path: executor catches the throw,
// returns `{ error }`, and the applier settles the held dapp request.
const makeThrowingSignHarness = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const approvals = createApprovalQueue();
  const activity = memoryActivityLog();
  const invoked: InvokeInput[] = [];
  const rpc = {
    async submitInvokeTransaction(input: InvokeInput) {
      // Drive the signer first: a device rejection surfaces here, before any
      // broadcast, so `invoked` stays empty on a sign failure (fail-closed).
      await input.signHash("0x1");
      invoked.push(input);
      return { calls: input.calls, transactionHash: "0x7cd" };
    },
  } as unknown as RuntimeRpc;
  const wallet = {
    ...walletStub([account]),
    async signHash(): Promise<never> {
      throw new WalletError("device rejected the transaction");
    },
  };
  const handler = createMessageHandler(wallet, "extension-id", {
    activity,
    approvals,
    preferencesStore: unavailablePreferencesStore,
    runtimeRpc: rpc,
    session,
  });
  return { activity, handler, invoked };
};

describe("invoke approval settles the held request when signing throws (A-H1)", () => {
  test("returns { error } and submits nothing instead of hanging the dapp promise", async () => {
    const { activity, handler, invoked } = makeThrowingSignHarness();

    const held = handler(invokeMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    // Approve: the executor's sign step throws, but the applier still settles the
    // held request with the real error rather than leaving the dapp promise open.
    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      error: "device rejected the transaction",
    });
    await expect(held).resolves.toEqual({ error: "device rejected the transaction" });
    expect(invoked).toHaveLength(0);
    expect(await activity.list()).toHaveLength(0);
  });
});

// A SN_SEPOLIA contact the SN_MAIN recipient mimics (same leading 6 + trailing
// 4). It must not influence a SN_MAIN transfer's risk flags — the dApp invoke
// path scopes its verify context to the active account's network, exactly like
// the in-wallet Send review (#19 decode/risk parity). Without that scoping the
// dApp card would raise an address-poisoning flag the Send review never would.
const CROSS_NETWORK_CONTACT = "0x55555500000000000000000000000000000000000000000000000000000abcd";
const POISONED_RECIPIENT = "0x555555fffffffffffffffffffffffffffffffffffffffffffffffffffffabcd";

const poisonAcrossNetworks = (): WalletPreferences => ({
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_MAIN",
  addressBook: [
    {
      address: CROSS_NETWORK_CONTACT,
      id: "SN_SEPOLIA:contact",
      label: "Sepolia savings",
      networkId: "SN_SEPOLIA",
    },
  ],
});

const poisonedTransferCall = {
  calldata: [POISONED_RECIPIENT, "1000", "0"],
  contractAddress: "0x123",
  entrypoint: "transfer",
};

describe("dApp invoke decode/risk parity with Send review (#19)", () => {
  test("scopes the verify context to the account's network, so a cross-network lookalike does not flag", async () => {
    const preferences = poisonAcrossNetworks();

    // Positive control: unscoped context (the old dApp behaviour) WOULD raise
    // address-poisoning, proving the divergence the network-scoping fix closes.
    const unscoped = verifyCalls([poisonedTransferCall], {
      account,
      addressBook: preferences.addressBook,
      tokens: preferences.tokens,
    });
    expect(unscoped.flags.some((flag) => flag.code === "address-poisoning")).toBe(true);

    const { handler, invoked } = makeHarness([account], fixedPreferencesStore(preferences));
    const held = handler(
      { calls: [poisonedTransferCall], origin, type: "wallet.addInvokeTransaction" as const },
      contentSender,
    );
    const pending = (
      await waitForPendingApprovals<{
        id: string;
        flags?: readonly { code: string }[];
        kind?: string;
      }>(handler, extensionSender)
    ).at(-1);

    expect(pending?.kind).toBe("invoke");
    // Network-scoped: the SN_SEPOLIA contact is filtered out, so no poisoning
    // flag — the dApp card and the Send review agree for this transfer.
    expect((pending?.flags ?? []).some((flag) => flag.code === "address-poisoning")).toBe(false);
    expect(invoked).toHaveLength(0);

    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });
});

// Queued approval snapshot fields the fee suite inspects.
type FeePending = {
  readonly fee?: { readonly overallFee: string; readonly unit: string } | null;
  readonly feeAffordability?: string;
  readonly feeEstimateFailed?: boolean;
  readonly feeEstimatePending?: boolean;
  readonly id: string;
  readonly requiresDeployment?: boolean;
};

const waitForSettledFee = async (
  handler: (m: unknown, s?: RuntimeSender) => Promise<unknown>,
  id: string,
): Promise<FeePending> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pending = await waitForPendingApprovals<FeePending>(handler, extensionSender);
    const approval = pending.find((entry) => entry.id === id);
    if (approval && approval.feeEstimatePending !== true) {
      return approval;
    }
    await flushHeld();
  }
  throw new Error("fee estimate did not settle");
};

// Queues one dapp invoke on the harness and returns the pending snapshot; the
// held request is denied afterwards by each test so nothing dangles.
const queueInvoke = async (handler: (m: unknown, s?: RuntimeSender) => Promise<unknown>) => {
  const held = handler(invokeMessage(), contentSender);
  const queued = (await waitForPendingApprovals<FeePending>(handler, extensionSender)).at(-1);
  if (!queued) {
    throw new Error("no pending approval");
  }
  const pending = await waitForSettledFee(handler, queued.id);
  return { held, pending };
};

describe("dApp invoke fee estimate (#189)", () => {
  test("foregrounds the approval before a slow fee estimate completes", async () => {
    let finishEstimate: (() => void) | undefined;
    const estimateGate = new Promise<void>((resolve) => {
      finishEstimate = resolve;
    });
    const { handler } = makeHarness([account], unavailablePreferencesStore, {
      async estimateInvokeFee() {
        await estimateGate;
        return { overallFee: "1", unit: "FRI" };
      },
    });

    const held = handler(invokeMessage(), contentSender);
    const queued = (await waitForPendingApprovals<FeePending>(handler, extensionSender)).at(-1);
    expect(queued?.feeEstimatePending).toBe(true);
    expect(queued?.fee).toBeNull();

    finishEstimate?.();
    const settled = await waitForSettledFee(handler, queued?.id ?? "");
    expect(settled.feeEstimatePending).toBe(false);
    expect(settled.fee).toEqual({ overallFee: "1", unit: "FRI" });

    await handler({ id: settled.id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("a deployed account's approval carries the estimate classified like the Send review", async () => {
    const { handler } = makeHarness();

    const { held, pending } = await queueInvoke(handler);
    expect(pending.fee).toEqual({ overallFee: "1", unit: "FRI" });
    expect(pending.feeEstimateFailed).toBe(false);
    expect(pending.feeEstimatePending).toBe(false);
    expect(pending.requiresDeployment).toBe(false);

    await handler({ id: pending.id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("an undeployed account carries no fee, no failure, and never estimates", async () => {
    let estimated = 0;
    const { handler } = makeHarness([account], unavailablePreferencesStore, {
      async estimateInvokeFee() {
        estimated += 1;
        return { overallFee: "1", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return false;
      },
    });

    const { held, pending } = await queueInvoke(handler);
    expect(pending.fee).toBeNull();
    expect(pending.feeEstimateFailed).toBe(false);
    expect(pending.requiresDeployment).toBe(true);
    expect(estimated).toBe(0);

    await handler({ id: pending.id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("a failing estimate degrades to a retryable failure and still queues the approval", async () => {
    const { handler } = makeHarness([account], unavailablePreferencesStore, {
      async estimateInvokeFee(): Promise<never> {
        throw new WalletError("rpc unreachable");
      },
    });

    const { held, pending } = await queueInvoke(handler);
    expect(pending.fee).toBeNull();
    expect(pending.feeEstimateFailed).toBe(true);
    expect(pending.requiresDeployment).toBe(false);

    await handler({ id: pending.id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("wallet.retryApprovalFee re-estimates a failed fee onto the queued approval", async () => {
    let attempts = 0;
    const { handler } = makeHarness([account], unavailablePreferencesStore, {
      async estimateInvokeFee() {
        attempts += 1;
        if (attempts === 1) {
          throw new WalletError("rpc unreachable");
        }
        return { overallFee: "42", unit: "FRI" };
      },
    });

    const { held, pending } = await queueInvoke(handler);
    expect(pending.feeEstimateFailed).toBe(true);

    await expect(
      handler({ id: pending.id, type: "wallet.retryApprovalFee" }, extensionSender),
    ).resolves.toEqual({ ok: true });
    const refreshed = (await waitForPendingApprovals<FeePending>(handler, extensionSender)).at(-1);
    expect(refreshed?.fee).toEqual({ overallFee: "42", unit: "FRI" });
    expect(refreshed?.feeEstimateFailed).toBe(false);

    await handler({ id: pending.id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("retry rejects an unknown approval id", async () => {
    const { handler } = makeHarness();
    await expect(
      handler(
        { id: "9e107d9d-372b-4b6b-8d0a-df1b6c8f6e01", type: "wallet.retryApprovalFee" },
        extensionSender,
      ),
    ).resolves.toEqual({ error: "approval not found" });
  });

  test("retry is privileged: a content-script sender is rejected before dispatch", async () => {
    const { handler } = makeHarness();
    const { held, pending } = await queueInvoke(handler);

    await expect(
      handler({ id: pending.id, type: "wallet.retryApprovalFee" }, contentSender),
    ).resolves.toEqual({ error: "privileged sender required" });

    await handler({ id: pending.id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("retry on a locked wallet fails safely and leaves the approval queued", async () => {
    const { handler, session } = makeHarness();
    const { held, pending } = await queueInvoke(handler);

    session.lock();
    await expect(
      handler({ id: pending.id, type: "wallet.retryApprovalFee" }, extensionSender),
    ).resolves.toEqual({ error: "wallet locked" });

    session.unlock(vaultPassphrase);
    const kept = (await waitForPendingApprovals<FeePending>(handler, extensionSender)).at(-1);
    expect(kept?.id).toBe(pending.id);

    await handler({ id: pending.id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });
});

// Fee-affordability guard (issue 191) on the dApp journey: the queued approval
// carries the shared predicate's verdict, and an unreadable balance fails open.
describe("dApp invoke fee affordability (issue 191)", () => {
  test("the verdict rides the fee review and fails open on a balance error", async () => {
    const short = makeHarness([account], unavailablePreferencesStore, {
      async getTokenBalances({ tokens }) {
        return tokens.map((token) => ({ ...token, balance: "0", formatted: "0" }));
      },
    });
    const first = await queueInvoke(short.handler);
    expect(first.pending.fee).toEqual({ overallFee: "1", unit: "FRI" });
    expect(first.pending.feeAffordability).toBe("insufficient");
    await short.handler({ id: first.pending.id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(first.held).resolves.toEqual({ error: "request rejected" });

    const unreadable = makeHarness([account], unavailablePreferencesStore, {
      async getTokenBalances(): Promise<never> {
        throw new WalletError("balance unavailable");
      },
    });
    const second = await queueInvoke(unreadable.handler);
    expect(second.pending.feeAffordability).toBe("unknown");
    await unreadable.handler({ id: second.pending.id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(second.held).resolves.toEqual({ error: "request rejected" });
  });
});
