/**
 * Ranking for a token search over a list of symbols and names. Shared so every
 * screen that searches tokens orders its matches the same way.
 */

/**
 * Ranks how well an entry matches a lowercased query: exact symbol first, then
 * symbol prefix, name prefix, and finally substring hits — null when it does
 * not match. Ties are left to the caller's own order, so a catalog's volume
 * order survives: "usdc" surfaces USDC before Bridged USDC before the long tail.
 */
export const rankTokenQueryMatch = (
  entry: { readonly name: string; readonly symbol: string },
  query: string,
): number | null => {
  const symbol = entry.symbol.toLowerCase();
  const name = entry.name.toLowerCase();
  if (symbol === query) {
    return 0;
  }
  if (symbol.startsWith(query)) {
    return 1;
  }
  if (name.startsWith(query)) {
    return 2;
  }
  if (symbol.includes(query) || name.includes(query)) {
    return 3;
  }
  return null;
};
