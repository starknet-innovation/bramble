/**
 * Presentation formatters shared by the data-driven screens. These replace the
 * per-screen `formatUSD` helpers that previously lived beside the hardcoded
 * sample data. All are pure and take real numeric inputs from the hooks.
 */

/** Formats a USD number with thousands separators and 2 decimals. */
export const formatUsd = (value: number): string =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Formats a signed USD amount with a leading + / -. */
export const formatSignedUsd = (value: number): string =>
  `${value < 0 ? "-" : "+"}${formatUsd(Math.abs(value))}`;

/** Formats a large USD figure compactly, e.g. `$684.2M`, `$1.28B`. */
export const formatCompactUsd = (value: number): string => {
  if (!Number.isFinite(value) || value === 0) {
    return "$0";
  }
  return `$${value.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  })}`;
};

/**
 * Formats a unit price with a decimal count that scales with magnitude, so
 * sub-dollar tokens keep precision and large prices stay readable.
 */
export const formatPrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const digits = value === 0 ? 2 : value < 1 ? 6 : value < 1000 ? 4 : 2;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 1000 ? 2 : 2,
    maximumFractionDigits: digits,
  })}`;
};

/**
 * Converts a smallest-unit token balance (u256 as a bigint) into a human decimal
 * string using pure string math, then trims trailing fractional zeros. Returns
 * both the display string and a JS number for downstream arithmetic (USD value).
 */
export const formatTokenAmount = (
  raw: bigint,
  decimals: number,
): { readonly display: string; readonly amount: number } => {
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, "0");
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPartRaw = decimals === 0 ? "" : digits.slice(digits.length - decimals);
  const fracPart = fracPartRaw.replace(/0+$/, "");
  const intWithSep = BigInt(intPart).toLocaleString("en-US");
  const display = `${negative ? "-" : ""}${
    fracPart === "" ? intWithSep : `${intWithSep}.${fracPart.slice(0, 6)}`
  }`;
  const amount = Number(`${negative ? "-" : ""}${intPart}${fracPart === "" ? "" : `.${fracPart}`}`);
  return { display, amount: Number.isFinite(amount) ? amount : 0 };
};
