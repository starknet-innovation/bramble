/**
 * Privacy integration — wraps the wallet's EXISTING native Starknet STRK20
 * shielded-pool surface (wallet_strk20*, Wallet-API 0.10.3). There is NO
 * external mixer contract here: these builders produce the canonical
 * STRK20_ACTION shapes from src/starknet/strk20/schemas.ts, which the existing
 * pipeline already consumes.
 *
 * Existing surface this composes with (do not re-implement):
 * - Action/validation shapes: src/starknet/strk20/schemas.ts (Strk20*Action,
 *   readStrk20Actions).
 * - Prepare (balance/leak checks + proof): prepareStrk20CallAndProof in
 *   src/starknet/strk20/service.ts.
 * - Background dispatch + approval hold: handleStrk20Ops
 *   ("wallet.strk20InvokeTransaction") and executeStrk20InvokeApproval in
 *   src/background/strk20-ops.ts, which calls runtimeRpc.submitInvokeTransaction.
 *
 * So a shielded flow is: build actions here -> feed the batch to the STRK20
 * invoke path -> user approves -> executeStrk20InvokeApproval submits the
 * prover-produced call. The submit/prove wiring is phase-2; the action builders
 * below are the real wrap.
 */
import type {
  Strk20DepositAction,
  Strk20TransferAction,
  Strk20WithdrawAction,
} from "../strk20/schemas";

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

// TODO(phase2): add a submit helper that hands a built action batch to the
// existing STRK20 invoke path (wallet.strk20InvokeTransaction ->
// executeStrk20InvokeApproval -> submitInvokeTransaction). Requires a configured
// proving backend (strk20ProverUrl); no new contract or SDK is needed.
