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
 * Wallet-API versions this wallet implements (API_VERSION values). Stable
 * `0.10.4` (starkware-libs/starknet-specs tag v0.10.4, commit cac6a4f9,
 * 2026-09-10; `info.version` "0.10.4") is the release whose names this wallet
 * speaks: `wallet_strk20ShadowAccountCommitment` and `shadow_account_invoke`,
 * which first shipped in 0.10.4-rc.1, plus the `valid_until` balance param
 * added in 0.10.4. `0.10.4-rc.0` is not advertised: it still names
 * `wallet_strk20SubaccountCommitment` / `subaccount_invoke`, which are refused.
 */
export const SUPPORTED_WALLET_API: readonly [string, ...string[]] = ["0.10.4"];

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

/**
 * True when a method's optional `api_version` param is absent or well-formed.
 * Every non-discovery param parser checks it this way, then drops it: only the
 * discovery methods negotiate a version, so a valid one never changes the
 * runtime message and a malformed one fails the whole request closed. Pure
 * predicate over untrusted page input; never throws.
 */
export const isOptionalApiVersion = (value: unknown): boolean =>
  value === undefined || isApiVersion(value);
