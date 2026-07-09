/**
 * Extended integration stub — perpetual derivatives (off-chain order matching,
 * on-chain StarkEx settlement). Unlike the swap/lending protocols, trading here
 * is NOT a wallet invoke: `fetchMarkets` reads the public markets API
 * (EXTENDED_API_BASE) and `signOrder` produces a SNIP-12 Stark-signed order
 * payload to POST to the exchange. Phase-2 fills these in; signing must go
 * through the vault Stark signer, never a local key.
 */
import { WalletError } from "../../shared/errors";
import type { PerpMarketInfo, PerpOrderParams, SignedPerpOrder } from "./types";

/**
 * Extended protocol id for tagging perps data.
 */
export const EXTENDED_PROTOCOL_ID = "extended" as const;

/**
 * Reads the public perpetual markets from the Extended API. TODO(phase2).
 */
export const fetchMarkets = (): Promise<readonly PerpMarketInfo[]> => {
  // TODO(phase2): GET {EXTENDED_API_BASE}/api/v1/info/markets and map each
  // MarketInfo into a PerpMarketInfo (name, lastPrice, fundingRate,
  // openInterest, maxLeverage, status).
  throw new WalletError("extended fetchMarkets not implemented");
};

/**
 * Builds and Stark-signs a perp order payload for the exchange. TODO(phase2).
 */
export const signOrder = (_params: PerpOrderParams): Promise<SignedPerpOrder> => {
  // TODO(phase2): construct the Order payload (marketName, side, size, price,
  // timeInForce, expiry), compute the SNIP-12 order hash, sign it via the vault
  // Stark signer, and return the payload + sig for POST /api/v1/user/order.
  throw new WalletError("extended signOrder not implemented");
};
