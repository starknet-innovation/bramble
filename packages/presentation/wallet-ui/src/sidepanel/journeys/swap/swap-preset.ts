/**
 * Which pair the swap opens on when another screen chose the sell side.
 * Separated from ./swap-ui so the choice is a pure function of the tracked
 * tokens, testable without the module state the screen keeps.
 */
import type { TokenConfig } from "@bramble/wallet-model/preferences";

/**
 * The pair to open on, or null when the chosen token is not tracked. The buy
 * side is STRK, or the first other token when the chosen one already is STRK,
 * so the pair reads the same wherever the entry came from.
 */
export const swapPresetPair = (
  sellId: string,
  tokens: readonly TokenConfig[],
): { readonly buyId: string | null; readonly sellId: string } | null => {
  if (!tokens.some((token) => token.id === sellId)) {
    return null;
  }
  const strk = tokens.find((token) => token.symbol === "STRK" && token.id !== sellId);
  return { buyId: (strk ?? tokens.find((token) => token.id !== sellId))?.id ?? null, sellId };
};
