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
 * Decides whether `balance` (raw STRK base units) covers the estimated fee
 * plus, when the transaction itself spends STRK, the amount being sent
 * (`sendAmount`, raw base units). Only `FRI` estimates are comparable against
 * a STRK balance; anything else is "unknown". Never throws.
 */
export const resolveFeeAffordability = (input: {
  readonly balance: string | null;
  readonly fee: { readonly overallFee: string; readonly unit: string } | null;
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
