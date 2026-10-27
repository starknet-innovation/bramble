/**
 * Chooses the STRK invoke, the STRK20 pool lane, or a gasless fee the user
 * picked. The gasless lane does not fall back to STRK.
 */

import type { MultisigStore } from "@bramble/multisig/repository";
import type { PriceService } from "@bramble/portfolio/prices";
import type { GaslessFeeOffer } from "@bramble/privacy/gasless-request";
import type { WalletPreferences, WalletPreferencesStore } from "@bramble/settings/preferences";
import type { StarkHashSigner } from "@bramble/starknet/provider";
import type { FeeEstimate } from "@bramble/starknet/rpc";
import type { ActivityLog } from "@bramble/transactions/activity";
import type { AllowanceStore } from "@bramble/transactions/allowance-store";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { Call } from "starknet";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { ApprovalPayload } from "../approvals/approvals";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { PassiveUnlockSession } from "../runtime/session";
import { executeReviewedGasless } from "../transactions/gasless-review";

/**
 * Dependencies needed to execute a held invoke approval once the user signs off.
 */
export type InvokeExecuteDeps = {
  readonly activity: ActivityLog;
  readonly allowanceStore: AllowanceStore;
  /**
   * Panel round-trip queue for keyless Ledger accounts. Optional so partial test
   * stubs stay valid; a Ledger invoke with no queue wired fails closed.
   */
  readonly ledgerSignQueue?: LedgerSignQueue;
  /**
   * Watched shared accounts, read into the trusted set for the execution-time
   * lookalike check (Sherlock 140). Omitted, that check skips them.
   */
  readonly multisigStore?: Pick<MultisigStore, "listMultisigs">;
  readonly preferencesStore: WalletPreferencesStore;
  /** Fiat prices for a gasless fee the user chose. Absent in narrow test doubles. */
  readonly prices?: PriceService;
  readonly runtimeRpc: RuntimeRpc;
  /**
   * Non-renewing session view: the user's approval click already renewed the
   * window, so executing the held calls must not renew it for the dapp.
   */
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Submits the held calls on the lane the approval selected.
 */
export const submitHeldInvoke = async (input: {
  readonly account: AccountRef;
  readonly approval: {
    readonly gaslessFee?: GaslessFeeOffer;
    readonly payload: ApprovalPayload;
    readonly reviewedFee?: FeeEstimate;
  };
  readonly calls: readonly Call[];
  readonly ceiling: { readonly reviewedFee?: FeeEstimate };
  readonly context: { readonly signHash: StarkHashSigner };
  readonly deps: InvokeExecuteDeps;
  readonly poolProof: ApprovalPayload["proof"];
  readonly preferences: WalletPreferences;
  readonly rememberHash: (hash: string) => void;
  readonly rpcUrls: readonly string[];
  readonly runtimeRpc: RuntimeRpc;
  readonly strk20: {
    readonly submitPrepared: (value: never) => Promise<{ readonly transactionHash: string }>;
  };
  readonly unlocked: () => boolean;
}): Promise<{
  readonly deploymentTransactionHash?: string;
  readonly transactionHash: string;
  readonly userFee?: {
    readonly amount: string;
    readonly token: string;
    readonly tokenAddress: string;
  };
}> => {
  const prices = input.deps.prices;
  const gaslessFee = input.approval.gaslessFee;
  if (input.poolProof) {
    return input.strk20.submitPrepared({
      ...input.context,
      calls: input.calls,
      proof: input.poolProof,
      ...input.ceiling,
    } as never);
  }
  if (gaslessFee && prices) {
    return executeReviewedGasless({
      account: input.account,
      calls: input.calls,
      gaslessFee,
      isAuthorized: input.unlocked,
      preferences: input.preferences,
      prices,
      runtimeRpc: input.runtimeRpc,
      signHash: input.context.signHash,
      strkFee: input.approval.reviewedFee ?? null,
    });
  }
  return input.runtimeRpc.submitInvokeTransaction({
    account: input.account,
    calls: input.calls,
    ...input.ceiling,
    isAuthorized: input.unlocked,
    onSigned: async (signed) => {
      input.rememberHash(signed.transactionHash);
    },
    ...(input.approval.payload.proof ? { proof: input.approval.payload.proof } : {}),
    rpcUrls: input.rpcUrls,
    signHash: input.context.signHash,
  });
};
