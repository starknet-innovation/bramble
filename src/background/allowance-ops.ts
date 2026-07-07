/**
 * Allowance-manager operations dispatched from the background message handler:
 * listing the ERC20 allowances this wallet granted and revoking one through the
 * verified invoke path. Approvals are recorded as they are submitted so the
 * manager can enumerate them without an on-chain indexer.
 */
import type { Call } from "starknet";
import { approveAllowancesFromCalls } from "../starknet/allowances";
import { STARKNET_NETWORKS } from "../starknet/networks";
import { buildErc20ApproveCall } from "../starknet/rpc";
import { verifyCalls } from "../starknet/verify";
import type { AllowanceStore } from "../storage/allowance-store";
import type { AccountRef } from "../storage/vault-schema";
import { readRevokeAllowanceInput } from "./allowance-inputs";
import { readTypeOnlyInput } from "./message-inputs";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { signerForContext, verificationContext, type WalletOpsDeps } from "./wallet-ops";

/**
 * Records every `approve` call in a submitted transaction so the allowance
 * manager can track and revoke it later. A zero amount clears the entry.
 * Best-effort: a bookkeeping write must never mask an already-submitted
 * transaction, so persistence failures are swallowed.
 */
export const recordApproveAllowances = async (
  store: AllowanceStore,
  calls: readonly Call[],
  account: AccountRef,
): Promise<void> => {
  for (const allowance of approveAllowancesFromCalls(calls, account)) {
    await store.record(allowance).catch(() => undefined);
  }
};

/**
 * Handles allowance-manager messages; returns null for other message types.
 */
export const handleAllowanceOps = async (
  deps: WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.allowances") {
    if (!readTypeOnlyInput(message, "wallet.allowances")) {
      return { error: "invalid allowances request" };
    }
    return { allowances: await deps.allowanceStore.list(), ok: true };
  }

  if (messageType === "wallet.revokeAllowance") {
    const input = readRevokeAllowanceInput(message);
    if (!input) {
      return { error: "invalid revoke request" };
    }
    const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
    if (context.error !== undefined) {
      return { error: context.error };
    }
    const record = (await deps.allowanceStore.list()).find((entry) => entry.id === input.id);
    if (!record) {
      return { error: "allowance not found" };
    }
    if (record.accountId !== context.account.id) {
      return { error: "switch to the account that granted this allowance" };
    }
    const preferences = await deps.preferencesStore.read();
    const call = buildErc20ApproveCall(record.token, record.spender, 0n);
    const report = verifyCalls([call], verificationContext(context.account, preferences));
    const result = await deps.runtimeRpc.submitInvokeTransaction({
      account: context.account,
      calls: [call],
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
      signHash: signerForContext(deps, context),
    });
    await deps.activity.record({
      accountId: context.account.id,
      hash: result.transactionHash,
      kind: "invoke",
      networkId: context.networkId,
      summary: report.calls[0]?.summary ?? "Revoke approval",
    });
    await deps.allowanceStore.record({
      accountId: context.account.id,
      amount: "0",
      networkId: context.networkId,
      spender: record.spender,
      token: record.token,
    });
    return { ok: true, transactionHash: result.transactionHash };
  }

  return null;
};
