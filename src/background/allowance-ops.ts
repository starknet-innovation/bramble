/**
 * Allowance-manager operations dispatched from the background message handler:
 * listing the ERC20 allowances this wallet granted and revoking one through the
 * verified invoke path. Approvals are recorded as they are submitted so the
 * manager can enumerate them without an on-chain indexer.
 */
import type { Call } from "starknet";
import { type ExternalAllowance, mergeAllowanceViews } from "../starknet/allowance-discovery";
import { approveAllowancesFromCalls } from "../starknet/allowances";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "../starknet/networks";
import { buildErc20ApproveCall } from "../starknet/rpc";
import { verifyCalls } from "../starknet/verify";
import { type AllowanceStore, allowanceTarget } from "../storage/allowance-store";
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
 * Discovers ERC20 allowances granted outside this wallet for the active
 * account's tracked tokens. Best-effort: with no discovery source wired, no
 * tracked tokens, or a failing query it yields an empty list so the manager
 * still lists the locally tracked (in-wallet) approvals.
 */
const discoverExternalAllowances = async (
  deps: WalletOpsDeps,
  context: { readonly account: AccountRef; readonly networkId: StarknetNetworkId },
): Promise<readonly ExternalAllowance[]> => {
  const scan = deps.runtimeRpc.getExternalAllowances;
  if (!scan) {
    return [];
  }
  const preferences = await deps.preferencesStore.read();
  const tokens = preferences.tokens
    .filter((token) => token.networkId === context.networkId)
    .map((token) => token.address);
  if (tokens.length === 0) {
    return [];
  }
  return scan({
    owner: context.account.address,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
    tokens,
  }).catch(() => []);
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
    // Scope the list to the active account: allowances granted by one account
    // must not appear (or be revocable) under another account.
    const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
    if (context.error !== undefined) {
      return { allowances: [], ok: true };
    }
    const all = await deps.allowanceStore.list();
    const inWallet = all.filter((entry) => entry.accountId === context.account.id);
    const external = await discoverExternalAllowances(deps, context);
    return {
      allowances: mergeAllowanceViews(inWallet, external, context.account, context.networkId),
      ok: true,
    };
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
    if (record && record.accountId !== context.account.id) {
      return { error: "switch to the account that granted this allowance" };
    }
    // A tracked (in-wallet) allowance is revoked from its stored record; an
    // externally discovered one is not in the store, so its token and spender
    // are recovered from the id, scoped to the active account. Setting an
    // allowance to zero can only reduce a spender's reach, and still runs
    // through the verified invoke path below either way.
    const target = record ?? allowanceTarget(input.id, context.account.id);
    if (!target) {
      return { error: "allowance not found" };
    }
    const preferences = await deps.preferencesStore.read();
    const call = buildErc20ApproveCall(target.token, target.spender, 0n);
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
      spender: target.spender,
      token: target.token,
    });
    return { ok: true, transactionHash: result.transactionHash };
  }

  return null;
};
