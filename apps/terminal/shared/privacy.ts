/**
 * Public, audited mainnet anchors shared by Terminal browser and server code.
 * Private discovery/prover upstream URLs and API keys are environment-only.
 */
export const PRIVACY_POOL_ADDRESS =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
export const AVNU_PAYMASTER_URL = "https://starknet.paymaster.avnu.fi";
export const PRIVATE_SWAP_FEE_TOKEN =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** Maximum requested private-swap slippage, shared by build and review. */
export const PRIVATE_SWAP_SLIPPAGE_BPS = 50;

/**
 * Independently reviewed private executor deployment. Never learn this anchor
 * from a quote/build response: it receives withdrawn tokens. No deployment
 * provenance was available during the v0.10.1 audit, so private swaps fail closed
 * until a reviewed address and source/upgrade policy are committed here.
 */
export const PRIVATE_SWAP_EXECUTOR: string | null = null;
