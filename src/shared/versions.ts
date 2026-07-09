/**
 * Single source of truth for the version strings this wallet advertises. Two
 * independent axes live here so runtime code and conformance fixtures import the
 * same definitions and can never silently drift:
 *  - SUPPORTED_SPECS: Starknet JSON-RPC spec versions (SPEC_VERSION values), as
 *    reported by wallet_supportedSpecs. This tracks what the bundled starknet
 *    client can actually speak.
 *  - SUPPORTED_WALLET_API: wallet-API versions (API_VERSION values), as reported
 *    by wallet_supportedWalletApi and negotiated via the optional api_version
 *    param on every method.
 */

/**
 * Starknet JSON-RPC spec versions this wallet targets (SPEC_VERSION values).
 * `0.10.0` is the default rpcVersion of the bundled starknet 10.0.2 client.
 */
export const SUPPORTED_SPECS: readonly [string, ...string[]] = ["0.10.0"];

/**
 * Wallet-API versions this wallet implements (API_VERSION values).
 */
export const SUPPORTED_WALLET_API: readonly [string, ...string[]] = ["0.7.2"];
