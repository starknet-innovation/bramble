/**
 * Inputs the dapp blocks share: the made-up sites and accounts, the chain ids the extension
 * binds, and how a refusal is written down. Every address is made up.
 */
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";

/** A site with no history in the wallet. */
export const SITE = "https://app.example";
/** A second site, for the per-site caps. */
export const OTHER_SITE = "https://other.example";

/** A made-up contract address. */
export const ACCOUNT = "0x7e00d496e324876bbc8531f2d9a82bf154d1a04a50218ee74cdd372f75a551a";

/** Chain ids as `STARKNET_NETWORKS` spells them. */
export const MAINNET_CHAIN_ID = STARKNET_NETWORKS.SN_MAIN.chainId;
export const SEPOLIA_CHAIN_ID = STARKNET_NETWORKS.SN_SEPOLIA.chainId;

/** What a thrown refusal looks like in the fixture: its message. */
export const thrownMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
