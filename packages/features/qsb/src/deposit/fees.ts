/**
 * A deposit's size, fee and MARA floor, ported from qsb-app
 * `src/lib/transactions.ts` (`fundingVsize`, `fundingFeeForRate`,
 * `minerMinimumRate`, `ceilMilliSatPerVb`, `belowMinerFloor`,
 * `formatFeeRate`, `withdrawalVsize`) for Bramble's one input type: the
 * owner's native P2WPKH outputs, never nested SegWit.
 *
 * Rates are integer millisatoshis per vB; amounts are bigint satoshis, so no
 * sum of inputs can lose precision. The vsize counts each input's witness at
 * the 72-byte DER maximum, so it is an upper bound and the paid rate is never
 * below the asked one. Pure.
 */

/** Bitcoin Core's dust limit for change to a P2WPKH address, in satoshis. */
export const QSB_CHANGE_DUST_LIMIT_SAT = 294n;

/** The highest MARA floor accepted, in millisatoshis per vB (1,000 sat/vB). */
export const QSB_MAX_RATE_MSAT = 1_000_000n;

// A P2WPKH output script: OP_0 and a 20-byte push.
const P2WPKH_SCRIPT_BYTES = 22;
// The largest standard output a withdrawal is estimated to pay (P2TR, P2WSH).
const WITHDRAWAL_OUTPUT_SCRIPT_BYTES = 34;
// Upper bound on a Config A QSB scriptSig (QSB_CONFIG_A_MAX_SCRIPTSIG).
const QSB_CONFIG_A_MAX_SCRIPTSIG = 1_185;

const varintSize = (n: number): number => (n < 0xfd ? 1 : n <= 0xffff ? 3 : 5);

/**
 * The vsize of a deposit spending `inputCount` owner outputs into a bare
 * script of `scriptBytes` bytes, with or without change back to the owner.
 */
export const qsbDepositVsize = (
  inputCount: number,
  scriptBytes: number,
  change: boolean,
): number => {
  const outputs =
    8 + varintSize(scriptBytes) + scriptBytes + (change ? 8 + 1 + P2WPKH_SCRIPT_BYTES : 0);
  const base =
    4 + varintSize(inputCount) + inputCount * 41 + varintSize(change ? 2 : 1) + outputs + 4;
  const witness = 2 + inputCount * (1 + 1 + 72 + 1 + 33);
  return Math.ceil((base * 4 + witness) / 4);
};

/** `rate × vsize`, rounded up to a whole satoshi. */
export const qsbFeeAt = (vsize: number, rateMsat: bigint): bigint =>
  (BigInt(vsize) * rateMsat + 999n) / 1000n;

/** A deposit's fee, its vsize, and the change it returns (0n for none). */
export type QsbDepositFee = {
  readonly changeSat: bigint;
  readonly feeSat: bigint;
  readonly vsize: number;
};

/**
 * The fee of depositing `amountSat` from inputs worth `inputValues`, at
 * `rateMsat`. With change when what is left after the with-change fee is at
 * least the dust limit; otherwise no change output, and the remainder is the
 * fee, which must still cover the no-change fee. Null when it cannot.
 */
export const qsbDepositFee = (input: {
  readonly amountSat: bigint;
  readonly inputValues: readonly bigint[];
  readonly rateMsat: bigint;
  readonly scriptBytes: number;
}): QsbDepositFee | null => {
  const { amountSat, inputValues, rateMsat, scriptBytes } = input;
  if (amountSat <= 0n || inputValues.length === 0) return null;
  const total = inputValues.reduce((sum, value) => sum + value, 0n);
  const withChange = qsbDepositVsize(inputValues.length, scriptBytes, true);
  const feeWithChange = qsbFeeAt(withChange, rateMsat);
  const changeSat = total - amountSat - feeWithChange;
  if (changeSat >= QSB_CHANGE_DUST_LIMIT_SAT) {
    return { changeSat, feeSat: feeWithChange, vsize: withChange };
  }
  const withoutChange = qsbDepositVsize(inputValues.length, scriptBytes, false);
  return total - amountSat >= qsbFeeAt(withoutChange, rateMsat)
    ? { changeSat: 0n, feeSat: total - amountSat, vsize: withoutChange }
    : null;
};

/** A sat/vB rate in millisatoshis per vB, rounded up, past float error. */
export const qsbCeilMilliSatPerVb = (satPerVb: number): bigint =>
  BigInt(Math.ceil(Math.round(satPerVb * 1e6) / 1e3));

/**
 * MARA's floor in millisatoshis per vB: the higher of `submit_fee_rate` and
 * `market_rate`, rounded up (`effective_rate` carries Slipstream's premium
 * and is ignored). Null for a floor that is not a finite rate in
 * `(0, 1,000]` sat/vB, which fails closed as an unavailable quote.
 */
export const qsbMinerFloorMsat = (rates: {
  readonly marketRate: number;
  readonly submitFeeRate: number;
}): bigint | null => {
  const floor = Math.max(rates.submitFeeRate, rates.marketRate);
  if (!Number.isFinite(floor) || floor <= 0) return null;
  const msat = qsbCeilMilliSatPerVb(floor);
  return msat > 0n && msat <= QSB_MAX_RATE_MSAT ? msat : null;
};

/** A rate in millisatoshis per vB as sat/vB decimal text: `2`, `2.25`. */
export const qsbFormatFeeRate = (rateMsat: bigint): string => {
  const fraction = (rateMsat % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${rateMsat / 1000n}${fraction ? `.${fraction}` : ""}`;
};

/**
 * The vsize of a signed withdrawal paying one output script of
 * `outputScriptBytes` bytes (qsb-app `withdrawalVsize`): input 0 the owner's
 * P2WPKH helper with its witness at the 72-byte DER maximum, input 1 the QSB
 * input at its largest scriptSig (1,185 bytes), so it is an upper bound:
 * P2WPKH 1,338 vB, P2SH 1,339, P2PKH 1,341, P2WSH and P2TR 1,350.
 */
export const qsbWithdrawalVsize = (outputScriptBytes: number): number => {
  const outputs = 1 + 8 + varintSize(outputScriptBytes) + outputScriptBytes;
  const base =
    4 +
    1 +
    41 +
    32 +
    4 +
    varintSize(QSB_CONFIG_A_MAX_SCRIPTSIG) +
    QSB_CONFIG_A_MAX_SCRIPTSIG +
    4 +
    outputs +
    4;
  const witness = 2 + (1 + 1 + 72 + 1 + 33) + 1;
  return Math.ceil((base * 4 + witness) / 4);
};

/**
 * The estimated fee of the vault's later withdrawal at `rateMsat`: one owner
 * P2WPKH helper input, the QSB input at its largest scriptSig, and one output
 * of the largest standard size, so the estimate is an upper bound.
 */
export const qsbWithdrawalFeeSat = (rateMsat: bigint): bigint =>
  qsbFeeAt(qsbWithdrawalVsize(WITHDRAWAL_OUTPUT_SCRIPT_BYTES), rateMsat);
