/**
 * Privacy integration — wraps the wallet's EXISTING native Starknet STRK20
 * shielded-pool surface (wallet_strk20*, Wallet-API 0.10.3). There is NO
 * external mixer contract here: these builders produce the canonical
 * STRK20_ACTION shapes from packages/foundation/wallet-protocol/src/strk20.ts, which the existing
 * pipeline already consumes.
 *
 * Existing surface this composes with (do not re-implement):
 * - Action/validation shapes: packages/foundation/wallet-protocol/src/strk20.ts (Strk20*Action,
 *   readStrk20Actions).
 * - Prepare (balance/leak checks + proof): prepareStrk20CallAndProof in
 *   packages/features/privacy/src/service.ts.
 * - Background dispatch + approval hold: handleStrk20Ops
 *   ("wallet.strk20InvokeTransaction") and executeStrk20InvokeApproval in
 *   apps/extension/src/background/strk20-ops.ts, which calls runtimeRpc.submitInvokeTransaction.
 *
 * So a shielded flow is: build actions here -> feed the batch to the STRK20
 * invoke path -> user approves -> executeStrk20InvokeApproval submits the
 * prover-produced call. The submit/prove wiring is phase-2; the action builders
 * below are the real wrap.
 */
import type {
  Strk20Action,
  Strk20DepositAction,
  Strk20TransferAction,
  Strk20WithdrawAction,
} from "./support/strk20-schemas";

/**
 * Inputs for a shield deposit (public -> private balance, always to self).
 */
export type PrivacyDepositParams = {
  readonly token: string;
  readonly amount: string;
};

/**
 * Inputs for an unshield withdraw (private balance -> public recipient).
 */
export type PrivacyWithdrawParams = {
  readonly token: string;
  readonly amount: string;
  readonly recipient: string;
};

/**
 * Inputs for a private transfer. `amount` may be the literal "OPEN" to create
 * an open note instead of a fixed-amount transfer.
 */
export type PrivacyTransferParams = {
  readonly token: string;
  readonly amount: string;
  readonly recipient: string;
};

/**
 * Builds a STRK20_DEPOSIT_ACTION for the native shielded pool.
 */
export const buildPrivacyDeposit = (params: PrivacyDepositParams): Strk20DepositAction => ({
  amount: params.amount,
  token: params.token,
  type: "deposit",
});

/**
 * Builds a STRK20_WITHDRAW_ACTION for the native shielded pool.
 */
export const buildPrivacyWithdraw = (params: PrivacyWithdrawParams): Strk20WithdrawAction => ({
  amount: params.amount,
  recipient: params.recipient,
  token: params.token,
  type: "withdraw",
});

/**
 * Builds a STRK20_TRANSFER_ACTION for the native shielded pool.
 */
export const buildPrivacyTransfer = (params: PrivacyTransferParams): Strk20TransferAction => ({
  amount: params.amount,
  recipient: params.recipient,
  token: params.token,
  type: "transfer",
});

/**
 * A batch of privacy actions submitted together in one shielded transaction.
 * Members come from the builders above; the union type keeps a mixed batch (e.g.
 * a deposit alongside a transfer) assignable in a single array.
 */
export type PrivacyActionBatch = readonly Strk20Action[];

/**
 * Inputs for the shielded invoke request: the built action batch plus the origin
 * whose live connection grant authorizes the STRK20 transaction. `origin` must
 * be a normalized wallet origin the background already trusts.
 */
export type PrivacyInvokeParams = {
  readonly actions: PrivacyActionBatch;
  readonly origin: string;
};

/**
 * The `wallet.strk20InvokeTransaction` request envelope consumed by the existing
 * background STRK20 handler (handleStrk20Ops). It carries exactly the keys that
 * handler validates — the action batch and the origin — and nothing else.
 */
export type PrivacyInvokeRequest = {
  readonly actions: PrivacyActionBatch;
  readonly origin: string;
  readonly type: "wallet.strk20InvokeTransaction";
};

/**
 * Builds the STRK20 invoke request for a shielded action batch, handing it to
 * the existing invoke path without broadcasting. The caller posts this message
 * to the background (chrome.runtime); handleStrk20Ops queues it as a "Private
 * transaction" approval, and only executeStrk20InvokeApproval re-prepares the
 * prover call and submits it once the user confirms. No new contract or SDK is
 * involved — the flow only needs a configured prover (strk20ProverUrl).
 */
export const buildPrivacyInvokeRequest = (params: PrivacyInvokeParams): PrivacyInvokeRequest => ({
  actions: params.actions,
  origin: params.origin,
  type: "wallet.strk20InvokeTransaction",
});
