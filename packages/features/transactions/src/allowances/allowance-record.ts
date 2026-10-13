/**
 * The allowance log's record types, split from ./allowance-store so the pure
 * modules beside it (./allowance-revoke) can name them without importing the
 * store. Import them through `@bramble/transactions/allowance-store`, which
 * re-exports everything here.
 */
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";

/**
 * Fields describing one allowance the user granted through this wallet.
 *
 * `lowerBound` marks an amount the wallet knows is AT LEAST this large but
 * cannot state exactly: an `increase_allowance` applied on top of a base this
 * wallet never saw (granted on the dapp's own site, or evicted by the retention
 * cap) is the increment plus an unknown base. Absent means the amount is the
 * exact standing allowance. Only `true` is representable, so "exact" has one
 * spelling; the manager renders a lower bound as "at least N" rather than
 * claiming a spender's reach is smaller than it is.
 *
 * A lower bound of ZERO is therefore the weakest honest statement the log can
 * make — "this pair is approved for an amount this wallet cannot bound" — and
 * is deliberately NOT a removal: a decrease applied to an unseen base leaves an
 * allowance the user must still be able to see and revoke.
 */
export type AllowanceInput = {
  readonly accountId: string;
  readonly amount: string;
  readonly lowerBound?: true;
  readonly networkId: StarknetNetworkId;
  readonly spender: string;
  readonly token: string;
};

/**
 * A relative allowance change: ERC20's `increase_allowance` adds to the standing
 * allowance and `decrease_allowance` subtracts from it, so neither can be stored
 * without the current total. Applied by {@link AllowanceStore.applyDelta}.
 * `transactionHash` is the transaction that carried the change, kept only if
 * the change turns out to be a revoke (see {@link AllowanceRecord}).
 */
export type AllowanceDelta = {
  readonly direction: "add" | "subtract";
  readonly input: AllowanceInput;
  readonly transactionHash?: string;
};

/**
 * The account an allowance belongs to: the scope every id, retention bound, and
 * manager query is keyed by. Named separately from `AllowanceInput` because the
 * owner is not always a vault account — a multisig execution grants from the
 * multisig contract's own scope (`ArgentMultisigRecord.id`, which shares the
 * `<networkId>:<address>` shape), not from the signer that broadcast it.
 */
export type AllowanceOwner = Pick<AllowanceInput, "accountId" | "networkId">;

/**
 * One tracked allowance with a deterministic id derived from its account,
 * token, and spender.
 *
 * `revoking` marks a grant whose revocation (an `approve(spender, 0)`, or a
 * decrease to zero from an exact base) this wallet has submitted but the chain
 * has not yet confirmed. The record keeps the grant's last known amount, which
 * is still the spender's reach until the revoke executes and stays its reach
 * if the revoke reverts (Sherlock 192). Only `true` is representable.
 *
 * `revokeHash` is the canonical hash of the transaction that carried that
 * revoke, so its outcome can settle the mark (issue 647): a revoke the chain
 * rejected or reverted clears `revoking`, as does an accepted one the chain
 * still reads as non-zero; only a zero reading removes the record. It exists
 * only beside `revoking`, and only on the stored record —
 * a display view never carries it. A revoke recorded before the field existed
 * has none and settles on a zero reading alone, as it always did.
 */
export type AllowanceRecord = AllowanceInput & {
  readonly id: string;
  readonly revokeHash?: string;
  readonly revoking?: true;
};
