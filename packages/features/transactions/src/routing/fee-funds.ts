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
import { isBaseUnitsAmount } from "@bramble/core/json";
import { type FeeEstimate, reviewedFeeCeiling } from "@bramble/starknet/fee-bounds";
import { isStarkFieldElement } from "@bramble/wallet-model/networks";

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

// Strict base units: a canonical decimal (the shared amount grammar) or a
// lowercase-hex field element, as a pool fee is quoted. Anything else, blank
// and whitespace included, is no figure at all — `BigInt("")` would read 0.
const strictBaseUnits = (value: string | null): bigint | null =>
  value !== null && (isBaseUnitsAmount(value) || isStarkFieldElement(value)) ? BigInt(value) : null;

/**
 * What a shield needs from the public STRK balance, and how much of it is
 * missing (issue 665). `need` is the pool fee (`poolFeeFri`), the most the
 * network fee may be signed for, and — only when the shielded token is STRK
 * (`shieldsStrk`) — the amount (`amount`, raw STRK base units).
 *
 * The network share is {@link reviewedFeeCeiling} of the reviewed FRI fee. The
 * submission refuses, before signing, any resource bounds whose
 * `max_amount x max_price_per_unit` spend exceeds that ceiling, on every speed
 * and with a zero tip (`@bramble/starknet/rpc-submit`,
 * `tests/starknet/rpc-submit-fee-bounds.test.ts`), so the signed maximum is
 * never above it and "up to" is true. `short` is how far `balance` (raw STRK
 * base units) falls below `need`, or `0n` when it covers it.
 *
 * Fails open: a missing, blank or malformed balance or pool fee, a non-FRI or
 * malformed network fee, or a STRK shield without a readable amount yields
 * `null` — no numeric claim, never a fabricated shortfall. Never throws.
 */
export const shieldStrkNeed = (input: {
  readonly amount: bigint | null;
  readonly balance: string | null;
  readonly networkFee: FeeEstimate | null;
  readonly poolFeeFri: string | null;
  readonly shieldsStrk: boolean;
}): { readonly need: bigint; readonly short: bigint } | null => {
  const balance =
    input.balance !== null && isBaseUnitsAmount(input.balance) ? BigInt(input.balance) : null;
  const poolFee = strictBaseUnits(input.poolFeeFri);
  const network = input.networkFee?.unit === "FRI" ? reviewedFeeCeiling(input.networkFee) : null;
  const amount = input.shieldsStrk ? input.amount : 0n;
  if (balance === null || poolFee === null || network === null || amount === null || amount < 0n) {
    return null;
  }
  const need = poolFee + network + amount;
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

/**
 * Whether `balance` covers a fee denominated in that same token, plus an
 * optional amount of the token the transaction itself spends. STRK fees stay
 * on {@link resolveFeeAffordability}. An unreadable balance or amount is
 * "unknown" and must not be offered as a way to pay.
 */
export const resolveTokenFeeAffordability = (input: {
  readonly amount: string | null;
  readonly balance: string | null;
  readonly sendAmount?: bigint | null;
}): FeeAffordability => {
  if (input.amount === null || input.balance === null) {
    return "unknown";
  }
  const amount = asBigInt(input.amount);
  const balance = asBigInt(input.balance);
  if (amount === null || balance === null || amount < 0n || balance < 0n) {
    return "unknown";
  }
  const required = amount + (input.sendAmount ?? 0n);
  return balance >= required ? "ok" : "insufficient";
};
