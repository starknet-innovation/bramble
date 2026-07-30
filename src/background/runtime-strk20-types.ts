/**
 * STRK20 response envelopes returned by privileged background handlers.
 */
import type { Strk20BalanceEntry, Strk20CallAndProof } from "../starknet/strk20/schemas";

/**
 * STRK20 private balances returned through the dapp provider bridge.
 */
export type Strk20BalancesResponse = {
  readonly balances: readonly Strk20BalanceEntry[];
  readonly ok: true;
};

/**
 * STRK20 prepared call-and-proof returned through the dapp provider bridge.
 */
export type Strk20PrepareResponse = {
  readonly callAndProof: Strk20CallAndProof;
  readonly ok: true;
};

/**
 * Locally derived dapp-scoped STRK20 sub-account commitment.
 */
export type Strk20SubaccountCommitmentResponse = {
  readonly commitment: string;
  readonly ok: true;
};
