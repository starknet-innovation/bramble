/**
 * STRK20 shielded-pool action shapes consumed by the privacy protocol module.
 *
 * These are the canonical STRK20_ACTION types the MC Wallet extension's native
 * shielded-pool surface (wallet_strk20*, Wallet-API 0.10.3) already understands.
 * Only the type declarations the terminal's privacy builders emit are ported
 * here; the extension's runtime validators/readers (readStrk20Actions,
 * prepareStrk20CallAndProof) stay in the extension — the terminal only builds
 * the request envelope and posts it to the wallet for proving + approval.
 */

/**
 * STRK20_DEPOSIT_ACTION: move a token amount from the public to the private
 * balance (always to self).
 */
export type Strk20DepositAction = {
  readonly amount: string;
  readonly token: string;
  readonly type: "deposit";
};

/**
 * STRK20_WITHDRAW_ACTION: move a token amount from the private balance to a
 * public recipient address.
 */
export type Strk20WithdrawAction = {
  readonly amount: string;
  readonly recipient: string;
  readonly token: string;
  readonly type: "withdraw";
};

/**
 * STRK20_TRANSFER_ACTION: privately transfer a token amount to a registered
 * recipient inside the pool. `amount` may be the literal "OPEN" to create an
 * open note instead of transferring a fixed amount.
 */
export type Strk20TransferAction = {
  readonly amount: string;
  readonly recipient: string;
  readonly token: string;
  readonly type: "transfer";
};

/**
 * STRK20_INVOKE_ACTION: invoke an arbitrary contract as part of the same STRK20
 * transaction. Calldata items are FELTs or wallet-resolved placeholder strings.
 */
type Strk20InvokeAction = {
  readonly calldata: readonly string[];
  readonly contract: string;
  readonly type: "invoke";
};

/**
 * STRK20_ACTION: the discriminated union of the four privacy actions, keyed on
 * the `type` field.
 */
export type Strk20Action =
  | Strk20DepositAction
  | Strk20InvokeAction
  | Strk20TransferAction
  | Strk20WithdrawAction;
