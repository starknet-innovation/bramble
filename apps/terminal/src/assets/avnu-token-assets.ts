import manifest from "./avnu-token-assets.json";
import { canonicalAddress } from "../protocols/support/networks";
import { publicAssetRoot } from "./public-asset-root";

const AVNU_TOKEN_ASSETS: Readonly<Record<string, string>> = manifest;
const ASSET_ROOT = publicAssetRoot("token-assets/avnu");
const COINGECKO_THUMBNAIL =
  /^(https:\/\/assets\.coingecko\.com\/coins\/images\/\d+)\/(?:small|standard)\//;

const highFidelityProviderUri = (logoUri: string | null): string | null => {
  const uri = logoUri?.trim() ?? "";
  return uri === "" ? null : uri.replace(COINGECKO_THUMBNAIL, "$1/large/");
};

/**
 * Resolves same-origin AVNU artwork by canonical token address. Newly listed
 * tokens fall back to their provider URI, with CoinGecko thumbnails upgraded
 * to the higher-fidelity rendition.
 */
export const avnuTokenArtwork = (address: string, logoUri: string | null): string | null => {
  const canonical = canonicalAddress(address);
  if (canonical !== null && Object.hasOwn(AVNU_TOKEN_ASSETS, canonical)) {
    return `${ASSET_ROOT}/${AVNU_TOKEN_ASSETS[canonical]}`;
  }
  return highFidelityProviderUri(logoUri);
};
