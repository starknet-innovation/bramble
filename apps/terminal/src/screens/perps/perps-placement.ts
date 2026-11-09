/**
 * Extended perps order placement: the recorded decision (#69, Decision A).
 *
 * Order placement is OFF everywhere. The Perps screen shows live public market
 * data from Extended (markets, stats, candles, order book, trades, funding), but
 * the terminal has no path that can place an order:
 *
 * - Extended orders are off-chain: an order is a StarkEx limit order signed with
 *   the account's Stark key and sent to Extended's private REST API. That is
 *   unlike the on-chain protocols here, which build `Call[]` for the wallet to
 *   review and execute. No vault op signs Extended orders, and the terminal never
 *   holds keys, so there is nothing to wire a ticket to.
 * - The earlier unwired order builder and its signing stub were removed. The
 *   Extended data layer only issues GET requests and opens public WS streams.
 * - The ticket stays visible so the market can be read in context, but its CTA
 *   and its Deposit / Withdraw buttons are disabled and carry the reason below.
 *
 * Enabling placement later (Decision B) needs a background op that signs the
 * order through the vault Stark signer, behind an off-by-default flag. Until
 * then this stays the single source of truth for the gate.
 */

/**
 * Placement state for the Extended ticket. Only `gated` exists today, so an
 * "enabled but unsigned" ticket cannot be represented.
 */
export type PerpsOrderPlacement = { readonly status: "gated"; readonly reason: string };

/**
 * Why the order ticket cannot place an order. Shown in the screen banner and
 * under the disabled CTA. Change the wording here and nowhere else.
 */
export const ORDER_DISABLED_REASON =
  "Order placement requires a signed session and isn't available in your region.";

/**
 * The shipped placement decision: gated, everywhere.
 */
export const PERPS_ORDER_PLACEMENT: PerpsOrderPlacement = {
  reason: ORDER_DISABLED_REASON,
  status: "gated",
};
