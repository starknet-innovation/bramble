/**
 * Independent ceiling for a gasless fee. The paymaster quotes the token
 * amount; this bounds it from the wallet's own STRK estimate and fiat
 * prices, never from the paymaster's price. Twenty percent over that
 * reference is the reviewed margin.
 */

/**
 * Numerator of the gasless margin: 6/5 is 20% over the independent price.
 * Not {@link STRK20_FEE_CEILING_MULTIPLIER}, which is a separate 2× band.
 */
export const GASLESS_FEE_CEILING_NUMERATOR = 6n;

/**
 * Denominator of the gasless margin. Paired with
 * {@link GASLESS_FEE_CEILING_NUMERATOR}.
 */
export const GASLESS_FEE_CEILING_DENOMINATOR = 5n;

const pow10 = (decimals: number): bigint => 10n ** BigInt(decimals);

/**
 * What `strkFee` base units of STRK are worth in the fee token, from two
 * scaled fiat prices of the same currency. Rounds down. Returns null when a
 * price is missing or a decimal count is not a real token width — the caller
 * then does not offer that token.
 */
export const convertStrkFeeToToken = (input: {
  readonly strkDecimals: number;
  readonly strkFee: bigint;
  readonly strkPrice: bigint;
  readonly tokenDecimals: number;
  readonly tokenPrice: bigint;
}): bigint | null => {
  if (
    !Number.isInteger(input.strkDecimals) ||
    !Number.isInteger(input.tokenDecimals) ||
    input.strkDecimals < 0 ||
    input.tokenDecimals < 0 ||
    input.strkDecimals > 36 ||
    input.tokenDecimals > 36 ||
    input.strkFee <= 0n ||
    input.strkPrice <= 0n ||
    input.tokenPrice <= 0n
  ) {
    return null;
  }
  return (
    (input.strkFee * input.strkPrice * pow10(input.tokenDecimals)) /
    (input.tokenPrice * pow10(input.strkDecimals))
  );
};

/**
 * Highest token amount the wallet will sign for `reference` base units of
 * that token. Rounds up so the 20% margin is not shortened by division.
 * A non-positive reference yields zero, which refuses every quote.
 */
export const gaslessFeeCeiling = (reference: bigint): bigint =>
  reference > 0n
    ? (reference * GASLESS_FEE_CEILING_NUMERATOR + GASLESS_FEE_CEILING_DENOMINATOR - 1n) /
      GASLESS_FEE_CEILING_DENOMINATOR
    : 0n;
