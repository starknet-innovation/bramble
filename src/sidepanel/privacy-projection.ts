/**
 * Live shield/unshield projection for the compose card. Computes what actually
 * arrives on the destination side and the fee sentence beneath it, plus the
 * fee-aware Max so an amount can never be composed that the fee makes
 * unaffordable. Pure string/bigint math — no DOM, no clock, no wallet access.
 */

import { formatTokenAmount, parseTokenAmount } from "../starknet/rpc";
import { compactAmount } from "./token-row";

/**
 * Inputs describing one direction of the compose card.
 */
export type ProjectionInput = {
  readonly amount: string;
  readonly decimals: number;
  /** Whether the moved asset is the same token the pool fee is charged in. */
  readonly feeInSameToken: boolean;
  /** Pool action fee in FRI, when known. */
  readonly poolFeeFri: string | undefined;
  readonly sourceBalanceRaw: string;
  readonly symbol: string;
  readonly unshielding: boolean;
};

/**
 * What the destination panel shows and why.
 */
export type Projection = {
  /** Fee sentence for the line under the card; empty when nothing is known. */
  readonly feeNote: string;
  /** Destination amount, already net of any fee taken from the moved value. */
  readonly received: string;
};

const safeParse = (amount: string, decimals: number): bigint | null => {
  if (amount.trim() === "") {
    return 0n;
  }
  try {
    const parsed = parseTokenAmount(amount, decimals);
    return parsed < 0n ? null : parsed;
  } catch {
    return null;
  }
};

/**
 * Projects the destination amount and fee note for the current compose state.
 * Shielding pays the pool fee from the public balance, so the private side
 * receives the full amount; unshielding pays the relay fee out of shielded
 * balance, and that fee is only known once the review has a quote.
 */
export const projectPrivacyMove = (input: ProjectionInput): Projection => {
  const parsed = safeParse(input.amount, input.decimals);
  if (parsed === null) {
    return { feeNote: "", received: "0" };
  }
  const received = compactAmount(formatTokenAmount(parsed, input.decimals));
  if (input.unshielding) {
    return {
      feeNote:
        parsed === 0n
          ? ""
          : "A relay fee is taken from your private balance. The exact amount is quoted on the next screen.",
      received,
    };
  }
  // No amount yet means no fee sentence: an idle card stays quiet.
  if (parsed === 0n || input.poolFeeFri === undefined) {
    return { feeNote: "", received };
  }
  let fee: bigint;
  try {
    fee = BigInt(input.poolFeeFri);
  } catch {
    return { feeNote: "", received };
  }
  if (fee === 0n) {
    return { feeNote: "", received };
  }
  const feeAmount = `${compactAmount(formatTokenAmount(fee, 18))} STRK`;
  const affordable = !input.feeInSameToken || parsed + fee <= BigInt(input.sourceBalanceRaw || "0");
  return {
    feeNote: affordable
      ? `Plus a ${feeAmount} pool fee from your public balance.`
      : `Not enough to cover the ${feeAmount} pool fee as well. Lower the amount.`,
    received,
  };
};

/**
 * Largest amount that can be composed: the whole source balance, minus the
 * pool fee when that fee is charged in the same asset and paid from the same
 * (public) side. Returns a decimal string for the amount input.
 */
export const maxPrivacyMove = (input: {
  readonly decimals: number;
  readonly feeInSameToken: boolean;
  readonly poolFeeFri: string | undefined;
  readonly sourceBalanceRaw: string;
  readonly unshielding: boolean;
}): string => {
  let balance: bigint;
  try {
    balance = BigInt(input.sourceBalanceRaw || "0");
  } catch {
    return "0";
  }
  if (input.unshielding || !input.feeInSameToken || input.poolFeeFri === undefined) {
    return formatTokenAmount(balance, input.decimals);
  }
  let fee: bigint;
  try {
    fee = BigInt(input.poolFeeFri);
  } catch {
    return formatTokenAmount(balance, input.decimals);
  }
  return formatTokenAmount(balance > fee ? balance - fee : 0n, input.decimals);
};
