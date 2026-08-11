import type { TokenRow } from "../../data/index";

const normalizedUsdcSymbol = (symbol: string): string =>
  symbol.toUpperCase().replace(/[._-]E$/, "");

const isUsdcRepresentation = (token: TokenRow): boolean =>
  normalizedUsdcSymbol(token.symbol) === "USDC" ||
  token.name.toUpperCase().includes("BRIDGED USDC");

const isBridgedUsdc = (token: TokenRow): boolean =>
  token.name.toUpperCase().includes("BRIDGED") || /[._-]E$/i.test(token.symbol);

/**
 * Collapses native and bridged USDC only in Discover's market ranking. Contract
 * lists and balances remain distinct anywhere the address affects an action.
 */
export const collapseDiscoverTokenRepresentations = (
  tokens: readonly TokenRow[],
): readonly TokenRow[] => {
  let usdc: TokenRow | null = null;
  const rows: TokenRow[] = [];
  for (const token of tokens) {
    if (!isUsdcRepresentation(token)) {
      rows.push(token);
      continue;
    }
    if (usdc === null || (isBridgedUsdc(usdc) && !isBridgedUsdc(token))) {
      usdc = token;
    }
  }
  if (usdc !== null) rows.push(usdc);
  return rows;
};
