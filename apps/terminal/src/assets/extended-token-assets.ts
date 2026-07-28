import symbols from "./extended-token-symbols.json";
import { publicAssetRoot } from "./public-asset-root";

const EXTENDED_TOKEN_SYMBOLS = new Set<string>(symbols);
const ASSET_ROOT = publicAssetRoot("token-assets/extended");

/**
 * Returns the locally bundled Extended artwork URL for a market base asset.
 * Unknown symbols return null and therefore retain TokenIcon's ticker fallback.
 */
export const extendedTokenLogo = (symbol: string): string | null => {
  const normalized = symbol.trim();
  return EXTENDED_TOKEN_SYMBOLS.has(normalized)
    ? `${ASSET_ROOT}/${encodeURIComponent(normalized)}.svg`
    : null;
};
