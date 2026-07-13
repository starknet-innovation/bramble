/**
 * Result and parameter parsers shared by the provider bridge. Kept separate
 * from bridge.ts so the wire-facing module stays small: this file validates
 * background results into spec-exact dapp shapes and maps failures to spec
 * `{ code, message, data? }` error objects.
 */

import { hasOnlyKnownKeys, isJson, isRecord, type Json } from "../shared/json";
import { errorForMessage, unknownError, type WalletRpcError } from "../shared/rpc-errors";
import { isStarknetNetworkId, type StarknetNetworkId } from "../starknet/networks";
import { isAccountRef } from "../storage/vault-schema";
import { providerStrk20Balances, providerStrk20CallAndProof } from "./strk20-bridge";

/**
 * Page-facing account view: only the already-public address and network id.
 */
export type PublicAccount = { readonly address: string; readonly networkId: StarknetNetworkId };

/**
 * Internal camelCase call shape the background consumes for an invoke.
 */
export type ProviderInvokeCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

/**
 * Spec accounts result carried to the page (`{ accounts, ok: true }`).
 */
export type ProviderAccountsResult = {
  readonly accounts: readonly PublicAccount[];
  readonly ok: true;
};

/**
 * Spec invoke result carried to the page (`{ transaction_hash }`).
 */
export type ProviderInvokeResult = {
  readonly transaction_hash: string;
};

/**
 * Spec ACCOUNT_DEPLOYMENT_DATA carried to the page for wallet_deploymentData.
 * Felts are PADDED_FELT so a dapp can rely on a fixed width.
 */
export type ProviderDeploymentData = {
  readonly address: string;
  readonly calldata: readonly string[];
  readonly class_hash: string;
  readonly salt: string;
  readonly sigdata?: readonly string[];
  readonly version: 0 | 1;
};

/**
 * API_VERSION pattern accepted from dapps (`major.minor` with optional patch).
 */
export const API_VERSION_PATTERN = /^[0-9]+\.[0-9]+(\.[0-9]+)?$/;

/**
 * Spec declare result carried to the page (`{ transaction_hash, class_hash }`),
 * both padded to their respective spec widths.
 */
export type ProviderDeclareResult = {
  readonly class_hash: string;
  readonly transaction_hash: string;
};

/**
 * The payload passed between the content bridge and the page response builder:
 * a spec error object or an unvalidated success value.
 */
export type ProviderPayload = { readonly error?: WalletRpcError; readonly result?: unknown };

/**
 * Method key used to shape a background result into its dapp response.
 */
export type ProviderResultMethod =
  | "mc_accounts"
  | "mc_requestAccounts"
  | "wallet_addDeclareTransaction"
  | "wallet_addInvokeTransaction"
  | "wallet_deploymentData"
  | "wallet_addStarknetChain"
  | "wallet_getPermissions"
  | "wallet_requestAccounts"
  | "wallet_requestChainId"
  | "wallet_signTypedData"
  | "wallet_supportedSpecs"
  | "wallet_supportedWalletApi"
  | "wallet_strk20Balances"
  | "wallet_strk20InvokeTransaction"
  | "wallet_strk20PrepareInvoke"
  | "wallet_switchStarknetChain"
  | "wallet_watchAsset";

/**
 * Left-pads a felt to a spec PADDED_FELT (`0x` + 64 hex, lowercased). Returns
 * null for a non-hex value or one wider than 256 bits so a malformed hash never
 * reaches the dapp. A valid felt is < 2^252, so its padded form always has a
 * top nibble in 0-8, matching PADDED_TXN_HASH.
 */
export const padFelt = (value: string): string | null => {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    return null;
  }
  const hex = value.slice(2).replace(/^0+/, "") || "0";
  if (hex.length > 64) {
    return null;
  }
  return `0x${hex.padStart(64, "0").toLowerCase()}`;
};

/**
 * Reduces a validated account to its page-facing address + network id.
 */
const toPublicAccount = (account: PublicAccount): PublicAccount => ({
  address: account.address,
  networkId: account.networkId,
});

/**
 * Narrows an unknown value to a page-facing `{ address, networkId }` account.
 */
const isPublicAccount = (value: unknown): value is PublicAccount =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "networkId"]) &&
  typeof value["address"] === "string" &&
  value["address"].length > 0 &&
  isStarknetNetworkId(value["networkId"]);

// Validates an `{ accounts, ok: true }` envelope of `isMember` members unique
// under `keyOf`, returning the narrowed list or null.
const parseAccountsResult = <T>(
  result: unknown,
  isMember: (value: unknown) => value is T,
  keyOf: (value: T) => string,
): readonly T[] | null => {
  if (
    !isRecord(result) ||
    !isJson(result) ||
    !hasOnlyKnownKeys(result, ["accounts", "ok"]) ||
    result["ok"] !== true ||
    !Array.isArray(result["accounts"]) ||
    !result["accounts"].every(isMember)
  ) {
    return null;
  }
  const accounts = result["accounts"];
  return new Set(accounts.map(keyOf)).size === accounts.length ? accounts : null;
};

/**
 * Parses a page-facing accounts result, rejecting any record still carrying
 * derivation indices or public keys.
 */
export const providerAccountsResult = (result: unknown): ProviderAccountsResult | null => {
  const accounts = parseAccountsResult(
    result,
    isPublicAccount,
    (account) => `${account.networkId}:${account.address}`,
  );
  return accounts ? { accounts: accounts.map(toPublicAccount), ok: true } : null;
};

/**
 * Narrows an unknown value to a spec chain-id result (`{ chainId, ok: true }`).
 */
const providerChainIdResult = (result: unknown): { chainId: string } | null =>
  isRecord(result) &&
  isJson(result) &&
  hasOnlyKnownKeys(result, ["chainId", "ok"]) &&
  result["ok"] === true &&
  typeof result["chainId"] === "string" &&
  /^0x[0-9a-f]+$/.test(result["chainId"])
    ? { chainId: result["chainId"] }
    : null;

/**
 * Narrows an unknown value to a spec invoke result whose `transaction_hash` is
 * a PADDED_TXN_HASH (`0x` + 64 hex, top nibble 0-8).
 */
export const providerInvokeResult = (result: unknown): ProviderInvokeResult | null =>
  isRecord(result) &&
  isJson(result) &&
  hasOnlyKnownKeys(result, ["transaction_hash"]) &&
  typeof result["transaction_hash"] === "string" &&
  /^0x0[0-8][0-9a-f]{62}$/.test(result["transaction_hash"])
    ? { transaction_hash: result["transaction_hash"] }
    : null;

/**
 * Reads an optional `{ api_version }` discovery param, returning the version
 * string when present and valid, `undefined` when absent, or `null` when the
 * param is malformed so the caller can reject it as INVALID_REQUEST_PAYLOAD.
 */
export const readApiVersionParam = (params: Json | undefined): string | null | undefined => {
  if (params === undefined) {
    return undefined;
  }
  if (!isRecord(params) || !hasOnlyKnownKeys(params, ["api_version"])) {
    return null;
  }
  if (params["api_version"] === undefined) {
    return undefined;
  }
  return typeof params["api_version"] === "string" &&
    API_VERSION_PATTERN.test(params["api_version"])
    ? params["api_version"]
    : null;
};

/**
 * Validates the optional wallet_requestAccounts params (`silent_mode`,
 * `api_version`): true when absent or well-formed, false when an unexpected key
 * or malformed value is present so junk is not routed to a connect.
 */
export const isRequestAccountsParams = (params: Json | undefined): boolean =>
  params === undefined ||
  (isRecord(params) &&
    hasOnlyKnownKeys(params, ["api_version", "silent_mode"]) &&
    (params["silent_mode"] === undefined || typeof params["silent_mode"] === "boolean") &&
    (params["api_version"] === undefined ||
      (typeof params["api_version"] === "string" &&
        API_VERSION_PATTERN.test(params["api_version"]))));

/**
 * Narrows an unknown value to a spec declare result whose `transaction_hash` is
 * a PADDED_TXN_HASH and `class_hash` a PADDED_FELT (`0x` + 64 hex).
 */
export const providerDeclareResult = (result: unknown): ProviderDeclareResult | null =>
  isRecord(result) &&
  isJson(result) &&
  hasOnlyKnownKeys(result, ["class_hash", "transaction_hash"]) &&
  typeof result["transaction_hash"] === "string" &&
  /^0x0[0-8][0-9a-f]{62}$/.test(result["transaction_hash"]) &&
  typeof result["class_hash"] === "string" &&
  /^0x[0-9a-f]{64}$/.test(result["class_hash"])
    ? { class_hash: result["class_hash"], transaction_hash: result["transaction_hash"] }
    : null;

/**
 * Narrows an unknown value to a non-empty array of non-empty felt strings.
 */
export const providerStringArrayResult = (result: unknown): readonly string[] | null =>
  Array.isArray(result) &&
  isJson(result) &&
  result.every((item) => typeof item === "string" && item.length > 0)
    ? result
    : null;

const toCalldataFelt = (value: unknown): string | null => {
  if (typeof value === "bigint" && value >= 0n) {
    return `0x${value.toString(16)}`;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return `0x${BigInt(value).toString(16)}`;
  }
  return typeof value === "string" ? value : null;
};

const readInvokeCall = (call: unknown): ProviderInvokeCall | null => {
  if (
    !isRecord(call) ||
    !hasOnlyKnownKeys(call, [
      "calldata",
      "contractAddress",
      "contract_address",
      "entry_point",
      "entrypoint",
    ])
  ) {
    return null;
  }
  const contractAddress =
    typeof call["contract_address"] === "string"
      ? call["contract_address"]
      : typeof call["contractAddress"] === "string"
        ? call["contractAddress"]
        : null;
  const entrypoint =
    typeof call["entry_point"] === "string"
      ? call["entry_point"]
      : typeof call["entrypoint"] === "string"
        ? call["entrypoint"]
        : null;
  const calldata = call["calldata"] ?? [];
  if (contractAddress === null || entrypoint === null || !Array.isArray(calldata)) {
    return null;
  }
  const felts = calldata.map(toCalldataFelt);
  if (!felts.every((item): item is string => item !== null)) {
    return null;
  }
  return { calldata: felts, contractAddress, entrypoint };
};

/**
 * Parses invoke params, accepting the spec `{ invoke_transaction: [...] }` and
 * the legacy `{ calls: [...] }` shapes, and rejecting a request that carries
 * both. The spec-defined optional `proof` key is accepted so a conforming
 * invoke carrying it is not rejected; the proof itself is not acted on here.
 * Returns the internal camelCase call list.
 */
export const providerInvokeCalls = (
  params: Json | undefined,
): readonly ProviderInvokeCall[] | null => {
  if (
    !isRecord(params) ||
    !hasOnlyKnownKeys(params, ["calls", "invoke_transaction", "proof"]) ||
    (Object.hasOwn(params, "calls") && Object.hasOwn(params, "invoke_transaction"))
  ) {
    return null;
  }
  const source = params["invoke_transaction"] ?? params["calls"];
  if (!Array.isArray(source) || source.length === 0) {
    return null;
  }
  const calls = source.map(readInvokeCall);
  return calls.every((call): call is ProviderInvokeCall => call !== null) ? calls : null;
};

/**
 * Reads a spec switch-chain param (`{ chainId }`) matching the CHAIN_ID pattern.
 * The spec-defined optional `silent_mode` (boolean) is accepted so a conforming
 * request carrying it is not rejected; the flag itself is not acted on here.
 */
export const providerSwitchChainId = (params: Json | undefined): string | null =>
  isRecord(params) &&
  hasOnlyKnownKeys(params, ["chainId", "silent_mode"]) &&
  (params["silent_mode"] === undefined || typeof params["silent_mode"] === "boolean") &&
  typeof params["chainId"] === "string" &&
  /^0x[0-9a-f]+$/.test(params["chainId"])
    ? params["chainId"]
    : null;

/**
 * Extracts the SNIP-12 typed data from sign params, accepting the spec
 * `{ typed_data }` wrapper, the legacy `{ typedData }` wrapper, and a bare
 * typed-data object passed directly as params.
 */
export const readTypedDataParam = (params: Json | undefined): Json | null => {
  if (params === undefined) {
    return null;
  }
  if (isRecord(params) && Object.hasOwn(params, "typed_data") && isJson(params["typed_data"])) {
    return params["typed_data"];
  }
  if (isRecord(params) && Object.hasOwn(params, "typedData") && isJson(params["typedData"])) {
    return params["typedData"];
  }
  return params;
};

// Pads a list of felts to PADDED_FELT, returning null if any entry will not pad.
const padFeltList = (values: readonly unknown[]): string[] | null => {
  const padded = values.map((value) => (typeof value === "string" ? padFelt(value) : null));
  return padded.every((value): value is string => value !== null) ? padded : null;
};

const deploymentPayload = (result: unknown): ProviderPayload => {
  const deployment = isRecord(result) && result["ok"] === true ? result["deployment"] : null;
  if (
    !isRecord(deployment) ||
    typeof deployment["address"] !== "string" ||
    typeof deployment["classHash"] !== "string" ||
    typeof deployment["salt"] !== "string" ||
    !Array.isArray(deployment["calldata"]) ||
    (deployment["version"] !== 0 && deployment["version"] !== 1)
  ) {
    return { error: unknownError() };
  }
  const address = padFelt(deployment["address"]);
  const classHash = padFelt(deployment["classHash"]);
  const salt = padFelt(deployment["salt"]);
  const calldata = padFeltList(deployment["calldata"]);
  if (address === null || classHash === null || salt === null || calldata === null) {
    return { error: unknownError() };
  }
  return {
    result: {
      address,
      calldata,
      class_hash: classHash,
      salt,
      version: deployment["version"],
    },
  };
};

/**
 * Converts background runtime results into provider success or rejection
 * payloads, mapping every failure to a spec `{ code, message, data? }` object.
 */
export const toProviderPayload = (
  result: unknown,
  method: ProviderResultMethod = "mc_accounts",
): ProviderPayload => {
  if (isRecord(result) && typeof result["error"] === "string") {
    return { error: errorForMessage(result["error"]) };
  }
  if (isRecord(result) && result["ok"] === false && isRecord(result["pending"])) {
    return { error: unknownError() };
  }
  if (method === "wallet_getPermissions") {
    const permissions =
      isRecord(result) && result["ok"] === true
        ? providerStringArrayResult(result["permissions"])
        : null;
    return permissions ? { result: permissions } : { error: unknownError() };
  }
  if (method === "wallet_supportedSpecs" || method === "wallet_supportedWalletApi") {
    const versions =
      isRecord(result) && result["ok"] === true
        ? providerStringArrayResult(result["versions"])
        : null;
    return versions ? { result: versions } : { error: unknownError() };
  }
  if (method === "wallet_deploymentData") {
    return deploymentPayload(result);
  }
  if (method === "wallet_watchAsset") {
    return isRecord(result) && result["ok"] === true && result["watched"] === true
      ? { result: true }
      : { error: unknownError() };
  }
  if (method === "wallet_signTypedData") {
    const signature = isRecord(result) && result["ok"] === true ? result["signature"] : null;
    return isRecord(signature) &&
      typeof signature["r"] === "string" &&
      typeof signature["s"] === "string" &&
      /^0x[0-9a-f]+$/.test(signature["r"]) &&
      /^0x[0-9a-f]+$/.test(signature["s"])
      ? { result: [signature["r"], signature["s"]] }
      : { error: unknownError() };
  }
  if (method === "wallet_strk20Balances") {
    const balances =
      isRecord(result) && result["ok"] === true ? providerStrk20Balances(result["balances"]) : null;
    return balances ? { result: balances } : { error: unknownError() };
  }
  if (method === "wallet_strk20PrepareInvoke") {
    const callAndProof =
      isRecord(result) && result["ok"] === true
        ? providerStrk20CallAndProof(result["callAndProof"])
        : null;
    return callAndProof ? { result: callAndProof } : { error: unknownError() };
  }
  const chainId = providerChainIdResult(result);
  if (method === "wallet_switchStarknetChain" && chainId) {
    return { result: true };
  }
  if (chainId) {
    return { result: chainId.chainId };
  }
  if (
    (method === "wallet_addInvokeTransaction" || method === "wallet_strk20InvokeTransaction") &&
    isRecord(result) &&
    typeof result["transactionHash"] === "string"
  ) {
    const padded = padFelt(result["transactionHash"]);
    // A hash the wallet itself produced that will not pad is an internal
    // failure, not a dapp payload problem, so it maps to UNKNOWN_ERROR.
    return padded ? { result: { transaction_hash: padded } } : { error: unknownError() };
  }
  if (method === "wallet_addStarknetChain") {
    return isRecord(result) && result["ok"] === true && result["added"] === true
      ? { result: true }
      : { error: unknownError() };
  }
  if (
    method === "wallet_addDeclareTransaction" &&
    isRecord(result) &&
    typeof result["transactionHash"] === "string" &&
    typeof result["classHash"] === "string"
  ) {
    const transactionHash = padFelt(result["transactionHash"]);
    const classHash = padFelt(result["classHash"]);
    // Hashes the wallet itself produced that will not pad are an internal
    // failure, not a dapp payload problem, so they map to UNKNOWN_ERROR.
    return transactionHash && classHash
      ? { result: { class_hash: classHash, transaction_hash: transactionHash } }
      : { error: unknownError() };
  }
  // Validate the full list here (trusted context), then reduce to the page view
  // so dapps never receive derivation indices, class hashes, or public keys.
  const accounts = parseAccountsResult(result, isAccountRef, (account) => account.id);
  if (!accounts) {
    return { error: unknownError() };
  }
  if (method === "wallet_requestAccounts") {
    return { result: accounts.map((account) => account.address) };
  }
  return { result: { accounts: accounts.map(toPublicAccount), ok: true } };
};
