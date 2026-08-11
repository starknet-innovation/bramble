/**
 * Pure assembly and validation for dapp watch-asset requests. On-chain metadata
 * is authoritative; dapp-provided options are used only as a fallback. The
 * result is shaped for the preferences token store and the approval queue.
 */
import { isSafeDecimals, isTokenSymbol } from "../shared/json";
import { canonicalAddress, type StarknetNetworkId } from "../starknet/networks";
import type { WatchAssetToken } from "./approvals";

/**
 * Dapp-provided watch-asset options after bridge validation.
 */
export type WatchAssetRequest = {
  readonly address: string;
  readonly decimals?: number;
  readonly name?: string;
  readonly symbol?: string;
};

/**
 * On-chain ERC20 metadata resolved before queueing, when available.
 */
export type WatchAssetMetadata = {
  readonly decimals: number;
  readonly name: string;
  readonly symbol: string;
};

// Restrict token names to printable ASCII (excluding angle-bracket markup) so a
// dapp cannot smuggle control characters, RTL overrides, or non-ASCII homoglyphs
// into a name the wallet later renders next to a balance. Note: the preferences
// token store (src/storage/preferences-store.ts, not owned here) keeps a looser
// length-only check; this boundary rejects hostile names before they reach it.
const isTokenName = (value: string): boolean =>
  value.length > 0 && value.length <= 64 && /^[\x20-\x7E]+$/.test(value) && !/[<>]/.test(value);

/**
 * Builds a validated watch-asset token from on-chain metadata and dapp options,
 * or returns null when the token cannot satisfy the wallet token contract.
 *
 * The address is canonicalized through the shared {@link canonicalAddress} so a
 * dapp cannot register a second record for a token the wallet already tracks by
 * spelling it differently.
 */
export const watchAssetToken = (
  request: WatchAssetRequest,
  metadata: WatchAssetMetadata | null,
  networkId: StarknetNetworkId,
): WatchAssetToken | null => {
  const address = canonicalAddress(request.address);
  if (address === null) {
    return null;
  }
  const rawSymbol = metadata?.symbol ?? request.symbol;
  const decimals = metadata?.decimals ?? request.decimals;
  if (typeof rawSymbol !== "string" || decimals === undefined) {
    return null;
  }
  const symbol = rawSymbol.trim().toUpperCase();
  const name = (metadata?.name ?? request.name ?? symbol).trim();
  if (!isTokenSymbol(symbol) || !isTokenName(name) || !isSafeDecimals(decimals)) {
    return null;
  }
  return { address, decimals, name, networkId, symbol };
};
