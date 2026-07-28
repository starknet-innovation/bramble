import type { SwapQuote } from "../protocols";

export type PickerTarget = "pay" | "receive";
export type SwapVenue = "avnu" | "ekubo";
export type QuoteState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly quote: SwapQuote; readonly receiveDecimals: number }
  | { readonly status: "error"; readonly message: string };

export const toSmallestUnit = (amount: string, decimals: number): string | null => {
  const trimmed = amount.trim();
  if (trimmed === "" || !/^\d*\.?\d*$/.test(trimmed)) {
    return null;
  }
  const [intPart = "0", fracRaw = ""] = trimmed.split(".");
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, "0");
  const combined = `${intPart}${frac}`.replace(/^0+/, "");
  return combined === "" ? null : combined;
};

export const fromSmallestUnit = (raw: string, decimals: number): string => {
  const padded = raw.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const value = Number(fracPart === "" ? intPart : `${intPart}.${fracPart}`);
  if (!Number.isFinite(value)) {
    return raw;
  }
  const digits = value < 1 ? 6 : value < 1_000 ? 4 : 2;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
};

export const amountInput = (value: number, decimals: number): string => {
  const fixed = value.toFixed(Math.min(decimals, 8));
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
};

export const usdValue = (amount: string, price: number | null): string => {
  const value = Number(amount);
  if (!Number.isFinite(value) || price === null) {
    return "—";
  }
  return (value * price).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
};
