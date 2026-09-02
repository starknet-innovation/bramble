/**
 * Side-panel client for fiat prices and the token price series.
 *
 * Prices are decoration, never authority: a malformed or refused reply degrades
 * to empty values so the panel simply omits fiat, rather than throwing and
 * blanking a balance list that is itself correct.
 *
 * Split out of `runtime.ts` so that file stays within the size budget; the
 * methods are spread back into the one client object the panel uses, so callers
 * see no seam.
 */

import { isPricesResponse, isTokenChartResponse } from "../../popup/responses/responses-prices";

/**
 * The message transport the client is built over: the panel's own
 * `chrome.runtime.sendMessage` wrapper, injected so this module holds no
 * browser handle of its own.
 */
export type PriceMessageSender = (message: unknown) => Promise<unknown>;

/**
 * Creates the price half of the side-panel wallet client. Neither method
 * rejects: an unusable reply reads as "no price data".
 */
export const createPriceRuntimeClient = (sendMessage: PriceMessageSender) => ({
  async loadPrices(cached = false): Promise<{
    readonly asOf: number | null;
    readonly changes: Readonly<Record<string, number>>;
    readonly prices: Readonly<Record<string, number>>;
    readonly stale: boolean;
  }> {
    const response = await sendMessage({
      ...(cached ? { cached: true } : {}),
      type: "wallet.prices",
    });
    if (!isPricesResponse(response)) {
      return { asOf: null, changes: {}, prices: {}, stale: false };
    }
    return {
      asOf: response.asOf ?? null,
      changes: response.changes ?? {},
      prices: response.prices,
      stale: response.stale ?? false,
    };
  },
  async loadTokenChart(address: string): Promise<readonly number[]> {
    const response = await sendMessage({ address, type: "wallet.tokenChart" });
    return isTokenChartResponse(response) ? response.points : [];
  },
});
