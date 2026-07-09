/**
 * Pure onboarding gate for the first-run real-funds acknowledgement. Creating a
 * wallet on Starknet Mainnet moves real funds, so onboarding requires the user
 * to explicitly acknowledge that before the wallet can be created. Testnet
 * networks (Sepolia, Local Devnet) hold no real funds, so the gate is skipped.
 *
 * Kept pure and free of DOM/network access so the gating rule stays exhaustively
 * testable, mirroring ./backup-verify. This does NOT change the default network:
 * Starknet Mainnet remains the default and this predicate only adds a safety
 * confirmation on top of it.
 */

/**
 * Network id whose wallets hold real funds and therefore require the
 * acknowledgement. Matches STARKNET_NETWORKS.SN_MAIN, kept as a local literal so
 * this gate does not depend on the (separately decided) default-network choice.
 */
export const MAINNET_NETWORK_ID = "SN_MAIN";

/**
 * Whether creating a wallet on the given network requires the real-funds
 * acknowledgement. Only Starknet Mainnet does.
 */
export const requiresMainnetAck = (networkId: string): boolean => networkId === MAINNET_NETWORK_ID;

/**
 * Whether onboarding may proceed for the selected network given whether the user
 * checked the acknowledgement. Testnets always pass; Mainnet passes only once
 * the acknowledgement is checked.
 */
export const mainnetAckSatisfied = (networkId: string, acknowledged: boolean): boolean =>
  !requiresMainnetAck(networkId) || acknowledged;
