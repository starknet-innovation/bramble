/**
 * Which of the owner's confirmed outputs pay a deposit: chosen by Bramble,
 * deterministically, so the same funds always give the same quote. Largest
 * value first, ties by txid then output index; the fewest of those, one to
 * eight, that cover the amount and the fee their own count implies. Choosing
 * coins by hand is out of scope. Pure.
 */
import { type QsbDepositFee, qsbDepositFee } from "./fees";

/** Most inputs one deposit spends (qsb-app's limit). */
export const QSB_MAX_DEPOSIT_INPUTS = 8;

/** One spendable owner output, as the coordinator lists it. */
export type QsbCoin = {
  readonly txid: string;
  readonly valueSat: number;
  readonly vout: number;
};

/** The chosen coins, in spending order, and the deposit's fee over them. */
export type QsbCoinSelection = QsbDepositFee & {
  readonly coins: readonly QsbCoin[];
};

const byPreference = (left: QsbCoin, right: QsbCoin): number => {
  if (left.valueSat !== right.valueSat) return right.valueSat - left.valueSat;
  if (left.txid !== right.txid) return left.txid < right.txid ? -1 : 1;
  return left.vout - right.vout;
};

/**
 * Selects coins for `amountSat` into a script of `scriptBytes` bytes at
 * `rateMsat`. Null when no prefix of at most eight preferred coins covers
 * amount plus fee: the deposit needs more bitcoin.
 */
export const selectQsbCoins = (input: {
  readonly amountSat: number;
  readonly coins: readonly QsbCoin[];
  readonly rateMsat: bigint;
  readonly scriptBytes: number;
}): QsbCoinSelection | null => {
  const ordered = [...input.coins].sort(byPreference);
  for (let count = 1; count <= Math.min(QSB_MAX_DEPOSIT_INPUTS, ordered.length); count += 1) {
    const coins = ordered.slice(0, count);
    const fee = qsbDepositFee({
      amountSat: BigInt(input.amountSat),
      inputValues: coins.map((coin) => BigInt(coin.valueSat)),
      rateMsat: input.rateMsat,
      scriptBytes: input.scriptBytes,
    });
    if (fee) {
      return { ...fee, coins };
    }
  }
  return null;
};
