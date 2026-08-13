/**
 * Readable, typed models for Extended's public market data. The wire format uses
 * a `{status,data,error}` REST envelope and terse single-letter aliases on the
 * candle / funding / order-book / trade payloads (o/h/l/c/v/T, m/f/T, m/b/a with
 * {p,q}, i/m/S/tT/T/p/q). The parsers in `parse.ts` decode those into the shapes
 * below so screens never touch a short key or a raw envelope.
 *
 * Decimal fields arrive as numeric strings on the wire; they are parsed to
 * `number` here for display/arithmetic. Where a live value's units are ambiguous
 * (notably `dailyPriceChange`) the ambiguity is flagged at the parse site.
 */
/**
 * MarketStatsModel — the per-market trading statistics block. Returned both
 * nested inside a market (endpoint #1) and standalone (endpoint #2). This is the
 * sole public source of mark/index price, open interest, and the current +
 * next funding rate (there are no dedicated REST endpoints for those).
 */
export type ExtendedMarketStats = {
  readonly dailyVolume: number;
  readonly dailyVolumeBase: number;
  /**
   * 24h price change as delivered by the API. UNITS FLAG: the catalog types this
   * as a raw Decimal; it is exposed here verbatim and interpreted as a fraction
   * (e.g. 0.0214 => +2.14%) at the display layer — confirm live whether the API
   * already returns whole percent.
   */
  readonly dailyPriceChange: number;
  readonly dailyLow: number;
  readonly dailyHigh: number;
  readonly lastPrice: number;
  readonly askPrice: number;
  readonly bidPrice: number;
  readonly markPrice: number;
  readonly indexPrice: number;
  readonly fundingRate: number;
  /** Epoch-ms timestamp of the next funding event. */
  readonly nextFundingRate: number;
  readonly openInterest: number;
  readonly openInterestBase: number;
};

/** TradingConfigModel — order/position limits + leverage caps for a market. */
export type ExtendedTradingConfig = {
  readonly minOrderSize: number;
  readonly minOrderSizeChange: number;
  readonly minPriceChange: number;
  readonly maxMarketOrderValue: number;
  readonly maxLimitOrderValue: number;
  readonly maxPositionValue: number;
  readonly maxLeverage: number;
  readonly maxNumOrders: number;
  readonly limitPriceCap: number;
  readonly limitPriceFloor: number;
  readonly riskFactorConfig: readonly {
    readonly upperBound: number;
    readonly riskFactor: number;
  }[];
};

/** L2ConfigModel — the StarkEx settlement parameters for a market. */
export type ExtendedL2Config = {
  readonly type: string;
  readonly collateralId: string;
  readonly collateralResolution: number;
  readonly syntheticId: string;
  readonly syntheticResolution: number;
};

/**
 * MarketModel — one market plus its nested stats/trading/L2 config. `type`
 * (PERPETUAL|SPOT) is present in the current docs but absent from SDK v0.4.5, so
 * it is nullable here (FLAG). `maxLeverage` is surfaced at the top level for
 * convenience (mirrors `tradingConfig.maxLeverage`).
 */
export type ExtendedMarket = {
  readonly name: string;
  readonly assetName: string;
  readonly assetPrecision: number;
  readonly collateralAssetName: string;
  readonly collateralAssetPrecision: number;
  readonly active: boolean;
  readonly type: string | null;
  readonly marketStats: ExtendedMarketStats | null;
  readonly tradingConfig: ExtendedTradingConfig | null;
  readonly l2Config: ExtendedL2Config | null;
  readonly maxLeverage: number;
};

/**
 * CandleModel decoded from the `{o,h,l,c,v?,T}` short-key shape. `time` is unix
 * *seconds* (converted from the wire's epoch-ms `T`) so it feeds the shared
 * `CandlestickChart` `data` prop directly.
 */
export type ExtendedCandle = {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number | null;
};

/** FundingRateModel decoded from `{m,f,T}`. `timestamp` is epoch ms. */
export type ExtendedFundingRate = {
  readonly market: string;
  readonly fundingRate: number;
  readonly timestamp: number;
};

/** One price level of an order book (decoded from `{p,q}`). */
export type ExtendedOrderBookLevel = {
  readonly price: number;
  readonly qty: number;
};

/**
 * OrderbookUpdateModel decoded from `{m,b,a}` — a full book (REST snapshot / WS
 * SNAPSHOT) or a set of changed levels (WS DELTA). `seq`/`ts` are carried from
 * the stream envelope when present so deltas can be ordered.
 */
export type ExtendedOrderBook = {
  readonly market: string;
  readonly bids: readonly ExtendedOrderBookLevel[];
  readonly asks: readonly ExtendedOrderBookLevel[];
  readonly seq: number | null;
  readonly ts: number | null;
};

/** Side of a public trade. */
export type ExtendedTradeSide = "BUY" | "SELL";

/**
 * PublicTradeModel decoded from `{i,m,S,tT,T,p,q}`. `tradeType` is the raw
 * TRADE|LIQUIDATION|DELEVERAGE string; `timestamp` is epoch ms.
 */
export type ExtendedPublicTrade = {
  readonly id: number;
  readonly market: string;
  readonly side: ExtendedTradeSide;
  readonly tradeType: string;
  readonly timestamp: number;
  readonly price: number;
  readonly qty: number;
};

/**
 * The parsed WS envelope common to every stream: `{type,data,error,ts,seq}`.
 * `type` is the `StreamDataType` discriminator (SNAPSHOT/DELTA/TRADE/…); `data`
 * is left raw here and decoded per-channel by the stream hooks.
 */
export type StreamEnvelope = {
  readonly type: string | null;
  readonly data: unknown;
  readonly error: string | null;
  readonly ts: number | null;
  readonly seq: number | null;
};

/** Current funding + recent history, as `useFunding` composes it. */
export type ExtendedFunding = {
  readonly latest: ExtendedFundingRate | null;
  readonly history: readonly ExtendedFundingRate[];
};
