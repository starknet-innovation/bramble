/**
 * Pure fee-affordability predicate shared by the in-wallet Send review and the
 * dApp invoke approval (issue 191): given a fee estimate and the account's
 * STRK balance, decide whether the account can pay for the transaction. One
 * predicate, both journeys — the same anti-drift requirement as the shared fee
 * renderer.
 *
 * The guard fails open by design: an unknown balance, a missing estimate, a
 * non-FRI fee unit (the STRK balance is not the denomination), or any
 * malformed numeric input yields "unknown" — never a fabricated verdict, and
 * callers must never block on it.
 */
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";

/**
 * Affordability verdict. "unknown" means no claim could be made and must be
 * treated as "do not warn, do not block" by every surface.
 */
export type FeeAffordability = "insufficient" | "ok" | "unknown";

const asBigInt = (value: string): bigint | null => {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

/**
 * What a shield needs from the public STRK balance, and how much of it is
 * missing (issue 665). `need` is the pool fee, the most the network fee may
 * be signed for (`networkMaxFee`, the reviewed ceiling rather than the bare
 * estimate, so the figure is an upper bound and "up to" is true), and the
 * amount when the shielded token is STRK itself (`amountIfStrk`, else `0n`).
 * `short` is how far `balance` (raw STRK base units) falls below `need`, or
 * `0n` when it covers it.
 *
 * Fails open like {@link resolveFeeAffordability}: an unknown or malformed
 * balance, an unknown network ceiling, or any negative figure yields `null` —
 * no claim, never a fabricated shortfall. Never throws.
 */
export const shieldStrkNeed = (input: {
  readonly amountIfStrk: bigint;
  readonly balance: string | null;
  readonly networkMaxFee: bigint | null;
  readonly poolFee: bigint;
}): { readonly need: bigint; readonly short: bigint } | null => {
  const balance = input.balance === null ? null : asBigInt(input.balance);
  if (
    balance === null ||
    input.networkMaxFee === null ||
    balance < 0n ||
    input.networkMaxFee < 0n ||
    input.poolFee < 0n ||
    input.amountIfStrk < 0n
  ) {
    return null;
  }
  const need = input.poolFee + input.networkMaxFee + input.amountIfStrk;
  return { need, short: need > balance ? need - balance : 0n };
};

/**
 * Decides whether `balance` (raw STRK base units) covers the estimated fee
 * plus, when the transaction itself spends STRK, the amount being sent
 * (`sendAmount`, raw base units). Only `FRI` estimates are comparable against
 * a STRK balance; anything else is "unknown". Never throws.
 */
export const resolveFeeAffordability = (input: {
  readonly balance: string | null;
  readonly fee: FeeEstimate | null;
  readonly sendAmount?: bigint | null;
}): FeeAffordability => {
  if (input.fee === null || input.fee.unit !== "FRI" || input.balance === null) {
    return "unknown";
  }
  const fee = asBigInt(input.fee.overallFee);
  const balance = asBigInt(input.balance);
  if (fee === null || balance === null || fee < 0n || balance < 0n) {
    return "unknown";
  }
  const required = fee + (input.sendAmount ?? 0n);
  return balance >= required ? "ok" : "insufficient";
};
