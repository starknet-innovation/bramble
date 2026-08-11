/**
 * Pure assembly and validation for dapp watch-asset requests. On-chain metadata
 * is authoritative; dapp-provided options are used only as a fallback. The
 * result is shaped for the preferences token store and the approval queue.
 */
import {
  isNonZeroStarkFieldElement,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import type { WatchAssetToken } from "../approvals/approvals";

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

const isTokenSymbol = (value: string): boolean => /^[A-Z0-9]{2,12}$/.test(value);

// Restrict token names to printable ASCII (excluding angle-bracket markup) so a
// dapp cannot smuggle control characters, RTL overrides, or non-ASCII homoglyphs
// into a name the wallet later renders next to a balance. Note: the preferences
// token store (packages/features/settings/src/preferences.ts, not owned here) keeps a looser
// length-only check; this boundary rejects hostile names before they reach it.
const isTokenName = (value: string): boolean =>
  value.length > 0 && value.length <= 64 && /^[\x20-\x7E]+$/.test(value) && !/[<>]/.test(value);

const isTokenDecimals = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0 && value <= 36;

/**
 * Canonicalizes a token contract address to lowercase, zero-padded 0x hex so
 * case- and padding-variant spellings of the same address compare equal for
 * validation and dedup. Returns null when the address is not a field element.
 */
export const canonicalTokenAddress = (address: string): string | null => {
  const lower = address.trim().toLowerCase();
  if (!isNonZeroStarkFieldElement(lower)) {
    return null;
  }
  return `0x${BigInt(lower).toString(16).padStart(64, "0")}`;
};

/**
 * Builds a validated watch-asset token from on-chain metadata and dapp options,
 * or returns null when the token cannot satisfy the wallet token contract.
 */
export const watchAssetToken = (
  request: WatchAssetRequest,
  metadata: WatchAssetMetadata | null,
  networkId: StarknetNetworkId,
): WatchAssetToken | null => {
  const address = canonicalTokenAddress(request.address);
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
  if (!isTokenSymbol(symbol) || !isTokenName(name) || !isTokenDecimals(decimals)) {
    return null;
  }
  return { address, decimals, name, networkId, symbol };
};
