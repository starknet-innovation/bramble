/**
 * Resolution of queued dapp approvals. `wallet.approveOrigin` settles the held
 * dapp request with its real result (granted accounts, signature, transaction
 * hash, tracked token, or new chain id) and clears the approval;
 * `wallet.denyOrigin` rejects the held request with a spec USER_REFUSED_OP so
 * the dapp promise settles rather than hanging. Only extension pages reach here.
 */
import type { ActivityLog } from "../storage/activity-store";
import type { AllowanceStore } from "../storage/allowance-store";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import { executeAddChainApproval } from "./add-chain-ops";
import type { ApprovalQueue } from "./approvals";
import { executeSignApproval, executeSwitchChainApproval } from "./chain-ops";
import { executeDeclareApproval } from "./declare-ops";
import { readApprovalIdInput } from "./message-inputs";
import { executeInvokeApproval } from "./provider-ops";
import type { RuntimeRpc } from "./runtime-rpc";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import type { UnlockSession } from "./session";
import type { SignatureWaiters } from "./signature-waiters";
import { executeStrk20InvokeApproval } from "./strk20-ops";

/**
 * Dependencies for resolving a queued approval into its settled result.
 */
export type ApprovalDecisionDeps = {
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  readonly approvals: ApprovalQueue;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly waiters: SignatureWaiters;
  readonly wallet: WalletStatusReader;
};

/**
 * Handles `wallet.approveOrigin` / `wallet.denyOrigin`; returns null otherwise.
 */
export const handleApprovalDecision = async (
  deps: ApprovalDecisionDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const { activity, allowanceStore, approvals, preferencesStore, runtimeRpc, session, waiters } =
    deps;
  const wallet = deps.wallet;

  if (messageType === "wallet.approveOrigin") {
    const input = readApprovalIdInput(message);
    if (!input) {
      return { error: "invalid approval request" };
    }
    const approval = approvals.get(input.id);
    if (!approval) {
      return { error: "approval not found" };
    }
    if (approval.kind === "watch-asset") {
      if (!approval.token) {
        return { error: "approval not found" };
      }
      await preferencesStore.upsertToken(approval.token);
      waiters.settle(input.id, { ok: true, watched: true });
      approvals.approve(input.id);
      return { ok: true, pending: approvals.list() };
    }
    if (approval.kind === "invoke") {
      const payload = approvals.payload(input.id);
      if (!payload) {
        return { error: "approval not found" };
      }
      const result = await executeInvokeApproval(
        { activity, allowanceStore, preferencesStore, runtimeRpc, session, wallet },
        { origin: approval.origin, payload },
      );
      waiters.settle(input.id, result);
      approvals.approve(input.id);
      if ("error" in result) {
        return result;
      }
      return { ok: true, pending: approvals.list() };
    }
    if (approval.kind === "strk20-invoke") {
      const payload = approvals.payload(input.id);
      if (!payload?.actions) {
        return { error: "approval not found" };
      }
      const result = await executeStrk20InvokeApproval(
        { activity, preferencesStore, runtimeRpc, session, wallet },
        { actions: payload.actions, origin: approval.origin },
      );
      waiters.settle(input.id, result);
      approvals.approve(input.id);
      if ("error" in result) {
        return result;
      }
      return { ok: true, pending: approvals.list() };
    }
    if (approval.kind === "sign-typed-data") {
      const payload = approvals.payload(input.id);
      if (payload?.typedData === undefined) {
        return { error: "approval not found" };
      }
      const result = await executeSignApproval(
        { preferencesStore, session, wallet },
        { origin: approval.origin, typedData: payload.typedData },
      );
      // Deliver the outcome back through the dapp's held request channel, then
      // clear the approval regardless (the request is resolved either way).
      waiters.settle(input.id, result);
      approvals.approve(input.id);
      if ("error" in result) {
        return result;
      }
      return { ok: true, pending: approvals.list() };
    }
    if (approval.kind === "switch-chain") {
      const payload = approvals.payload(input.id);
      if (payload?.networkId === undefined || payload.chainId === undefined) {
        return { error: "approval not found" };
      }
      const result = await executeSwitchChainApproval(
        { preferencesStore, session, wallet },
        { networkId: payload.networkId, origin: approval.origin },
      );
      waiters.settle(input.id, result);
      approvals.approve(input.id);
      if ("error" in result) {
        return result;
      }
      return { chainId: payload.chainId, ok: true, pending: approvals.list() };
    }
    if (approval.kind === "add-chain") {
      const payload = approvals.payload(input.id);
      if (payload?.chain === undefined) {
        return { error: "approval not found" };
      }
      const result = await executeAddChainApproval({ preferencesStore }, { chain: payload.chain });
      waiters.settle(input.id, result);
      approvals.approve(input.id);
      if ("error" in result) {
        return result;
      }
      return { ok: true, pending: approvals.list() };
    }
    if (approval.kind === "declare") {
      const payload = approvals.payload(input.id);
      if (payload?.declare === undefined) {
        return { error: "approval not found" };
      }
      const result = await executeDeclareApproval(
        { preferencesStore, runtimeRpc, session, wallet },
        { declare: payload.declare, origin: approval.origin },
      );
      waiters.settle(input.id, result);
      approvals.approve(input.id);
      if ("error" in result) {
        return result;
      }
      return { ok: true, pending: approvals.list() };
    }
    const passphrase = session.getPassphrase();
    if (!passphrase) {
      return { error: "wallet locked" };
    }
    const accounts = await wallet.grantOrigin({
      origin: approval.origin,
      vaultPassphrase: passphrase,
    });
    // Deliver the granted accounts back through the dapp's held requestAccounts
    // channel (if any) so enable() resolves after approval.
    waiters.settle(input.id, { accounts, ok: true });
    approvals.approve(input.id);
    return {
      accounts,
      ok: true,
    };
  }

  if (messageType === "wallet.denyOrigin") {
    const input = readApprovalIdInput(message);
    if (!input) {
      return { error: "invalid approval request" };
    }
    const denied = approvals.get(input.id);
    approvals.deny(input.id);
    // Reject the dapp's held request (if any) so it does not hang after a deny.
    if (denied && denied.kind !== "connect") {
      waiters.settle(input.id, { error: "request rejected" });
    } else if (denied) {
      waiters.settle(input.id, { error: "connection rejected" });
    }
    return { ok: true, pending: approvals.list() };
  }

  return null;
};
