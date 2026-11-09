/**
 * The terminal's one default swap slippage tolerance (#153). Every swap venue
 * (AVNU, Ekubo) and the swap ticket's initial setting read it from here, so a
 * quote taken without an explicit tolerance and the tolerance the ticket shows
 * before the wallet review can never disagree.
 */

/**
 * Default maximum slippage, in basis points (50 = 0.5%), applied when a caller
 * passes no `slippageBps`. 10 bps (the AVNU SDK default) is tight enough that
 * ordinary price movement between quote and execution often reverts a swap.
 */
export const DEFAULT_SLIPPAGE_BPS = 50;
