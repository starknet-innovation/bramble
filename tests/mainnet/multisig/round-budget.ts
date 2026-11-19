/**
 * Spend plan for one multisig privacy round. Every amount is fixed in code or
 * derived from the pool's own fee, so an environment variable cannot raise it.
 * The round moves STRK only: the funding account pays the multisig, and what
 * the multisig does not spend on fees goes back to the funding account.
 */
import { formatTokenAmount, parseTokenAmount } from "@bramble/starknet/rpc";
import { STRK_TOKEN_DECIMALS } from "@bramble/wallet-model/networks";
import { MAX_PROTOCOL_FEE_RAW } from "../strk20-pool-fee";

const strk = (amount: string): bigint => parseTokenAmount(amount, STRK_TOKEN_DECIMALS);

/**
 * Hard ceilings for the round, in FRI. A figure above its ceiling stops the
 * round before the step that would have spent it.
 */
export const ROUND_LIMITS = {
  /** Network fee the multisig keeps for deploy, register, deposit and the sweep. */
  gasReserve: strk("3"),
  /** Most the funding account ever sends to the multisig in one round. */
  maxFunding: strk("30"),
  /** Displayed fee ceiling for the multisig deployment. */
  maxDeployFee: strk("1"),
  /** Fee ceiling for a transaction that carries a proof (register, deposit). */
  maxProofTxFee: strk("3"),
  /** Fee ceiling for an ordinary transfer: the funding transfer and the sweep. */
  maxTransferFee: strk("0.5"),
  /** Private balance set aside for one relayed action's relay fee. */
  relayReserve: strk("1"),
  /** Principal of the private self-transfer. It never leaves the multisig. */
  transferAmount: strk("0.1"),
} as const;

/**
 * Why a quoted fee is refused, naming the figure so a too-tight ceiling can be
 * told from a real problem; null when it may be paid. `unit` and `overallFee`
 * are the wallet's fee review, which quotes the most the transaction may spend.
 */
export const feeRefusal = (
  fee: { readonly overallFee: string; readonly unit: string },
  ceiling: bigint,
  what: string,
): string | null => {
  if (fee.unit !== "FRI") {
    return `The ${what} fee is quoted in ${fee.unit}, not STRK. Nothing was sent.`;
  }
  const quoted = BigInt(fee.overallFee);
  return quoted > ceiling
    ? `The ${what} fee may reach ${formatTokenAmount(quoted, STRK_TOKEN_DECIMALS)} STRK, above its ${formatTokenAmount(ceiling, STRK_TOKEN_DECIMALS)} STRK ceiling. Nothing was sent.`
    : null;
};

/** Amounts one round commits to, all in FRI. */
export type RoundPlan = {
  /** STRK the multisig deposits into the pool. */
  readonly deposit: bigint;
  /** STRK the funding account sends to the multisig address. */
  readonly funding: bigint;
  readonly poolFee: bigint;
  readonly transferAmount: bigint;
};

/**
 * Sizes the round from the pool fee. The deposit covers two relayed actions
 * (the self-transfer and the withdrawal), each paying the pool fee and a relay
 * fee out of the private balance. The funding covers that deposit, the pool fee
 * of registration and of the deposit, and network fees. Throws when the pool
 * fee or the total is above its ceiling, so nothing is funded.
 */
export const planRound = (poolFee: bigint): RoundPlan => {
  if (poolFee < 0n || poolFee > MAX_PROTOCOL_FEE_RAW) {
    throw new Error("The privacy pool fee is above the round's ceiling. Nothing was funded.");
  }
  const deposit = 2n * (poolFee + ROUND_LIMITS.relayReserve) + ROUND_LIMITS.transferAmount;
  const funding = deposit + 2n * poolFee + ROUND_LIMITS.gasReserve;
  if (funding > ROUND_LIMITS.maxFunding) {
    throw new Error("The round would need more than the funding ceiling. Nothing was funded.");
  }
  return { deposit, funding, poolFee, transferAmount: ROUND_LIMITS.transferAmount };
};

/**
 * How much of `privateBalance` a withdrawal may name while leaving enough for
 * its own pool fee and relay fee. `observedActionCost` is what the self-transfer
 * cost; half as much again is kept for a fee that moved. Without an
 * observation the fixed reserve is used. Null means there is nothing worth
 * withdrawing.
 */
export const withdrawableAmount = (
  privateBalance: bigint,
  poolFee: bigint,
  observedActionCost: bigint | null,
): bigint | null => {
  const reserve =
    observedActionCost !== null && observedActionCost > 0n
      ? (observedActionCost * 3n) / 2n
      : poolFee + ROUND_LIMITS.relayReserve;
  const amount = privateBalance - reserve;
  return amount > 0n ? amount : null;
};

/**
 * How much of the multisig's public STRK the sweep may name. Twice the
 * prepared maximum fee stays behind, because the sweep is prepared a second
 * time at a fee that may have moved. Null means the balance cannot pay for
 * its own sweep, or `maxFee` is above the transfer ceiling.
 */
export const sweepableAmount = (publicBalance: bigint, maxFee: bigint): bigint | null => {
  if (maxFee <= 0n || maxFee > ROUND_LIMITS.maxTransferFee) {
    return null;
  }
  const amount = publicBalance - 2n * maxFee;
  return amount > 0n ? amount : null;
};
