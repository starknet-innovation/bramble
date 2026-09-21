/**
 * Validates a claimed approval against the wallet's live state before its
 * applier runs, and settles a claim that failed. Split from
 * ./approval-decisions to keep that module within the size budget.
 *
 * Trust boundary: the claim's review context (account, network, chain, payload
 * digest) was fixed when the request was queued; this re-checks every part of
 * it against the vault and preferences at decision time so a request cannot be
 * approved into a network or account the user did not review. Fails closed:
 * a locked wallet, a moved network, an account that is no longer granted, or a
 * payload that no longer matches its digest all refuse the approval.
 */

import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { UnlockSession } from "../runtime/session";
import { approvalPayloadMatchesContext } from "./approval-context";
import type { ApprovalClaim } from "./approvals";
import type { SignatureWaiters } from "./signature-waiters";

/** The collaborators claim validation and settlement read. */
export type ClaimContextDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly session: UnlockSession;
  readonly waiters: SignatureWaiters;
  readonly wallet: WalletStatusReader;
};

/**
 * Null when the claim may proceed; otherwise the refusal to settle it with.
 */
export const validateClaimContext = async (
  deps: ClaimContextDeps,
  claim: ApprovalClaim,
): Promise<RuntimeResponse | null> => {
  const { context } = claim.approval;
  if (!context) {
    return null;
  }
  const passphrase = deps.session.getPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await deps.preferencesStore.read();
  if (
    preferences.activeNetworkId !== context.networkId ||
    STARKNET_NETWORKS[context.networkId].chainId !== context.chainId
  ) {
    return { error: "approval context changed" };
  }
  const granted = await deps.wallet.getGrantedAccounts(claim.approval.origin, passphrase);
  if (
    !granted.some(
      (account) => account.id === context.accountId && account.networkId === context.networkId,
    )
  ) {
    return { error: "approval context changed" };
  }
  return claim.payload && (await approvalPayloadMatchesContext(context, claim.payload))
    ? null
    : { error: "approval payload changed" };
};

/** Settles the dapp's held request with the refusal and returns it for the panel. */
export const settleClaimError = (
  deps: ClaimContextDeps,
  id: string,
  response: RuntimeResponse,
): RuntimeResponse => {
  deps.waiters.settle(id, response);
  return response;
};
