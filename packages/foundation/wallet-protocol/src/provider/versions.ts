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
 * It also owns the API_VERSION grammar a dapp's version string is checked
 * against. This module imports nothing, so every param parser can reach that
 * grammar without an import cycle through the result parsers.
 */

/**
 * Starknet JSON-RPC spec versions this wallet targets (SPEC_VERSION values).
 * `0.10.0` is the default rpcVersion of the bundled starknet 10.0.2 client.
 */
export const SUPPORTED_SPECS: readonly [string, ...string[]] = ["0.10.0"];

/**
 * Wallet-API versions this wallet implements (API_VERSION values).
 */
export const SUPPORTED_WALLET_API: readonly [string, ...string[]] = ["0.10.4-rc.0"];

/**
 * API_VERSION pattern accepted from dapps (semantic version, including a
 * prerelease suffix used by published Wallet-API release candidates).
 */
export const API_VERSION_PATTERN =
  /^[0-9]+\.[0-9]+(?:\.[0-9]+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)?$/;

/**
 * True when `value` is a well-formed API_VERSION string. Shape only: whether
 * the version is supported is a separate check against SUPPORTED_WALLET_API.
 * Pure predicate over untrusted page input; never throws.
 */
export const isApiVersion = (value: unknown): value is string =>
  typeof value === "string" && API_VERSION_PATTERN.test(value);
