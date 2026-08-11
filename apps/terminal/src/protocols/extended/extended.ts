/**
 * Extended integration — perpetual derivatives on the x10/x10xchange StarkEx
 * exchange. Unlike the swap/lending protocols, trading here is NOT a wallet
 * invoke: `fetchMarkets` reads the public markets REST API and `signOrder`
 * assembles a StarkEx order payload plus its SNIP-12 order hash for the account's
 * Stark key to sign, then POSTs to `/api/v1/user/order`. This module never places
 * an order — it stops at producing the signable material.
 *
 * ⚠️ Region-lock: the exchange is geofenced (restricted jurisdictions cannot
 * trade), so both the read and order paths may return an access error even with
 * valid inputs; surface that to the user rather than retrying blindly.
 *
 * ⚠️ Signing: `PerpOrderParams` (the shared contract) carries neither the
 * signer's account address nor a vault handle, and the authoritative StarkEx
 * order hash also needs per-market context (vault id, asset ids, expiry) that is
 * not in the shared shape. So the vault Stark signer (WalletVaultService.signHash
 * / runtimeRpc, see background/*-ops.ts) does NOT fit this function's params.
 * The order payload + SNIP-12 typed data are built here; the actual hash+sign
 * step is stubbed with a TODO for the phase-2 background op that owns the
 * account address and the fetched market config.
 */
import { WalletError } from "../support/errors";
import { EXTENDED_API_BASE } from "../constants";
import { buildOrderPayload, EXTENDED_MARKETS_PATH, parseMarketsResponse } from "./extended-order";
import type { PerpMarketInfo, PerpOrderParams, SignedPerpOrder } from "../types";

/**
 * Extended protocol id for tagging perps data.
 */
export const EXTENDED_PROTOCOL_ID = "extended" as const;

// Fetches and JSON-parses an Extended API path, mapping any transport, HTTP, or
// body failure onto a stable WalletError so callers never see raw transport
// detail. The region-lock surfaces here as a non-ok response.
const fetchExtendedJson = async (path: string, onFailure: string): Promise<unknown> => {
  const url = `${EXTENDED_API_BASE.replace(/\/+$/, "")}${path}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    throw new WalletError(onFailure);
  }
  if (!response.ok) {
    throw new WalletError(onFailure);
  }
  try {
    return await response.json();
  } catch {
    throw new WalletError(onFailure);
  }
};

/**
 * Reads the public perpetual markets from the Extended API (BASE-USD symbols,
 * last price, funding rate, open interest, leverage caps, status). Public, no
 * auth. Malformed rows are dropped; a transport/region-lock failure throws.
 */
export const fetchMarkets = async (): Promise<readonly PerpMarketInfo[]> => {
  const body = await fetchExtendedJson(EXTENDED_MARKETS_PATH, "Extended markets request failed");
  return parseMarketsResponse(body);
};

/**
 * Builds and Stark-signs a perp order for the exchange. The order payload and
 * its SNIP-12 typed data are assembled and validated here; the final order-hash
 * computation and the Stark-key sig are deferred to the phase-2 background op
 * that holds the signer account and the exchange's per-market StarkEx config.
 */
export const signOrder = (params: PerpOrderParams): Promise<SignedPerpOrder> => {
  // Assemble + validate the signable material up front so a malformed order
  // (bad size/price/side) fails before any signing path is reached. The typed
  // data the account signs is derived from this payload via buildOrderTypedData
  // in the phase-2 op below.
  buildOrderPayload(params);

  // TODO(phase2): in a background handleExtendedOps, resolve the signer's account
  // address, fetch the market's StarkEx config from the exchange (vault id,
  // synthetic/collateral asset ids, expiry), build the typed data with
  // buildOrderTypedData, fold the config into the order hash
  // (orderMessageHash(typedData, accountAddress) for the SNIP-12 envelope; the
  // StarkEx limit-order hash for the on-exchange check), sign it via
  // WalletVaultService.signHash, and return { market, side, size, price,
  // payload, sig: { r, s } } for POST /api/v1/user/order.
  return Promise.reject(
    new WalletError("Extended order signing is not wired to the vault Stark signer"),
  );
};
