/**
 * Verified Starknet mainnet addresses and off-chain endpoints for the trade
 * terminal's protocol integrations. This is the single source of truth phase-2
 * protocol modules import from — token contracts, per-protocol contract
 * addresses, and API bases live here, never inline in the protocol stubs.
 *
 * Provenance: token contracts are cross-checked against
 * starknet-io/starknet-addresses (see /tmp recon). Protocol contract addresses
 * are transcribed from each protocol's published constants and are marked
 * VERIFY where the recon flagged that they must be re-confirmed on a mainnet
 * explorer before any transaction is signed against them.
 */

/**
 * Canonical Starknet mainnet ERC20 token contract addresses, keyed by symbol.
 * ETH and STRK match wallet-model/networks; the stablecoins and wrapped
 * assets are the verified mainnet deployments from the integrations recon.
 */
export const MAINNET_TOKEN_ADDRESSES = {
  DAI: "0x05574eb6b8789a91466f902c380d978e472db68170ff82a5b650b95a58ddf4ad",
  ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  USDC: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  USDT: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",
  WBTC: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
} as const;

/**
 * Symbol keys of the tracked mainnet token set.
 */
export type MainnetTokenSymbol = keyof typeof MAINNET_TOKEN_ADDRESSES;

/**
 * Canonical decimals for each tracked token. WBTC (8) and the 6-decimal
 * stablecoins must not fall back to the ERC20 default of 18, so they are
 * pinned here.
 */
export const MAINNET_TOKEN_DECIMALS: Readonly<Record<MainnetTokenSymbol, number>> = {
  DAI: 18,
  ETH: 18,
  STRK: 18,
  USDC: 6,
  USDT: 6,
  WBTC: 8,
} as const;

/**
 * The largest token precision the terminal accepts from a market API. Decimals
 * drive string padding while a screen renders, so an unbounded value from an
 * API (`Infinity`, `1e9`, a negative or fractional number) would throw inside
 * React and blank the screen (Sherlock 155).
 */
export const MAX_TOKEN_DECIMALS = 36;

/**
 * Whether an untrusted value is a usable token precision: an integer from 0 to
 * {@link MAX_TOKEN_DECIMALS}.
 */
export const isTokenDecimals = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_TOKEN_DECIMALS;

/**
 * Ekubo concentrated-liquidity AMM mainnet contracts. Verified in the Ekubo MCP
 * repo constants; re-check against docs.ekubo.org before mainnet swaps.
 */
export const EKUBO_ADDRESSES = {
  core: "0x00000005dd3D2F4429AF886cD1a3b08289DBcEa99A294197E9eB43b0e0325b4b",
  positions: "0x02e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067",
  positionsNft: "0x07b696af58c967c1b14c9dde0ace001720635a660a8e90c565ea459345318b30",
  routerV3: "0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e",
} as const;

/**
 * Ekubo off-chain API base (pool metadata, not required for on-chain quoting).
 */
export const EKUBO_API_BASE = "https://prod-api.ekubo.org";

/**
 * AVNU aggregator mainnet addresses and API bases. The exchange router is the
 * ERC20 `approve` spender for a `multi_route_swap`, verified against AVNU's
 * published mainnet Contracts & Audits reference.
 */
export const AVNU_ADDRESSES = {
  exchange: "0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f",
} as const;

/**
 * AVNU HTTP endpoints: the quote/build/execute API and the market-data service.
 */
export const AVNU_API = {
  base: "https://starknet.api.avnu.fi",
  impulse: "https://starknet.impulse.avnu.fi",
} as const;

/**
 * Vesu V2 lending mainnet anchors. In Vesu V2 there is no Singleton and no
 * per-pool extension — each pool is its OWN `Pool` contract, and its address IS
 * the value you call `modify_position` on. `primePoolId` is the V2 "Prime" pool
 * contract; `multiply` is the V2 Multiply contract. Per-asset vTokens (ERC-4626)
 * are still resolved dynamically from the Vesu API at runtime. The anchors
 * below are cross-checked against Vesu's published mainnet address registry and
 * their deployed class ABIs.
 *
 * Note: `primePoolId` was previously mis-named `genesisPoolId` (a V1 concept);
 * the value is unchanged — it is the V2 Prime pool contract address.
 */
export const VESU_ADDRESSES = {
  btcFiDistributor: "0x47ba31cdfc2db9bd20ab8a5b2788f877964482a8548a6e366ce56228ea22fa8",
  defiSpringDistributor:
    "0x387f3eb1d98632fbe3440a9f1385aec9d87b6172491d3dd81f1c35a7c61048f",
  multiply: "0x7964760e90baa28841ec94714151e03fbc13321797e68a874e88f27c9d58513",
  poolFactory: "0x3760f903a37948f97302736f89ce30290e45f441559325026842b7a6fb388c0",
  primePoolId: "0x0451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5",
} as const;

/**
 * Master gate for Vesu lending. Enabled after cross-checking `modify_position`,
 * `position`, vToken ERC-4626 entrypoints, and the signed Amount layout against
 * the deployed mainnet V2 class ABIs and the current vesuxyz/vesu-v2 source.
 * Transactions still pass through the terminal review and connected wallet.
 */
export const VESU_LENDING_ENABLED = true;

/**
 * Vesu API base. The recon repo pointed at STAGING; mainnet integrations must
 * use the production base below and re-resolve pool config from it.
 */
export const VESU_API_BASE = "https://api.vesu.xyz";

/**
 * Extended perpetuals exchange API base. Perps are settled off-chain via signed
 * StarkEx orders (SNIP-12), not wallet invoke transactions.
 */
export const EXTENDED_API_BASE = "https://api.starknet.extended.exchange";
