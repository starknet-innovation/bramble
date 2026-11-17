/**
 * The swap screen's value check from the wallet's own price feed (Sherlock
 * 137). The aggregator's USD figures describe its own quote, so an aggregator
 * that misprices a route can also report figures that hide the loss; pricing
 * both sides from the feed the wallet already shows balances in keeps the
 * check independent of the party being checked.
 */
import type { PriceService } from "@bramble/portfolio/prices";
import type { TokenConfig } from "@bramble/settings/preferences";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { DisplayCurrency } from "@bramble/wallet-model/preferences";

const unitPrice = (
  prices: Readonly<Record<string, number>>,
  token: TokenConfig,
): number | undefined => {
  const price = prices[token.address];
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : undefined;
};

/**
 * Percent by which the buy side is worth more (+) or less (−) than the sell
 * side, priced from the wallet's feed. Undefined when the feed has no price for
 * either token, the amounts do not parse, the feed cannot be read, or the feed
 * answered from a stale cache (a cached price for a moving token can show a
 * loss as break-even), so the screen relies on the aggregator's figures alone;
 * never throws.
 */
export const walletSwapValueDelta = async (input: {
  readonly buyAmount: string;
  readonly buyToken: TokenConfig;
  readonly currency: DisplayCurrency;
  readonly networkId: StarknetNetworkId;
  readonly prices: PriceService | undefined;
  readonly sellAmount: string;
  readonly sellToken: TokenConfig;
}): Promise<number | undefined> => {
  if (!input.prices) {
    return undefined;
  }
  try {
    const feed = await input.prices.getPrices({
      addresses: [input.sellToken.address, input.buyToken.address],
      currency: input.currency,
      networkId: input.networkId,
    });
    if (feed.stale) {
      return undefined;
    }
    const sellPrice = unitPrice(feed.prices, input.sellToken);
    const buyPrice = unitPrice(feed.prices, input.buyToken);
    const sellUnits = Number(input.sellAmount);
    const buyUnits = Number(input.buyAmount);
    if (
      sellPrice === undefined ||
      buyPrice === undefined ||
      !Number.isFinite(sellUnits) ||
      !Number.isFinite(buyUnits) ||
      sellUnits <= 0 ||
      buyUnits < 0
    ) {
      return undefined;
    }
    const sellValue = sellUnits * sellPrice;
    return ((buyUnits * buyPrice - sellValue) / sellValue) * 100;
  } catch {
    return undefined;
  }
};
