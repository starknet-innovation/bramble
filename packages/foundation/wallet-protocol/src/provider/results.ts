/**
 * Result and parameter parsers shared by the provider bridge. Kept separate
 * from bridge.ts so the wire-facing module stays small: this file validates
 * background results into spec-exact dapp shapes and maps failures to spec
 * `{ code, message, data? }` error objects.
 */

import {
  hasOnlyKnownKeys,
  hasUniqueStrings,
  isJson,
  isRecord,
  type Json,
} from "@bramble/core/json";
import { isAccountRef } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isHexChainId,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import { errorForMessage, unknownError, type WalletRpcError } from "./rpc-errors";

/**
 * The one hex chain-id grammar, re-exported for the page-facing provider. The
 * injected script may only reach `@bramble/wallet-protocol`, and a private
 * regex there would be a second definition of the form this module already
 * validates switch-chain params against — the drift MCW-V09-130 closed. Pure
 * predicate: it never throws and admits nothing `isHexChainId` rejects.
 */
export { isHexChainId } from "@bramble/wallet-model/networks";
export {
  type ProviderInvokeCall,
  providerInvokeCalls,
  providerInvokeRequest,
} from "../transactions/invoke";

import {
  providerStrk20Balances,
  providerStrk20CallAndProof,
  providerStrk20Commitment,
} from "../privacy/strk20-bridge";
import type { ProviderMethod } from "./methods";
import { isApiVersion, isOptionalApiVersion } from "./versions";

/**
 * Page-facing account view: only the already-public address and network id.
 */
export type PublicAccount = { readonly address: string; readonly networkId: StarknetNetworkId };

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
 * API_VERSION pattern accepted from dapps, re-exported from its single source
 * in versions.ts so existing `results` consumers keep one import.
 */
export { API_VERSION_PATTERN } from "./versions";

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
export type ProviderResultMethod = ProviderMethod;

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
  return hasUniqueStrings(accounts.map(keyOf)) ? accounts : null;
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
  isHexChainId(result["chainId"])
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
  return isApiVersion(params["api_version"]) ? params["api_version"] : null;
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
    isOptionalApiVersion(params["api_version"]));

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

/**
 * Reads a spec switch-chain param (`{ chainId }`) matching the CHAIN_ID pattern.
 * The spec-defined optional `silent_mode` (boolean) and `api_version` are
 * accepted so a conforming request carrying them is not rejected; neither is
 * acted on here, and a malformed value still rejects the request.
 */
export const providerSwitchChainId = (params: Json | undefined): string | null =>
  isRecord(params) &&
  hasOnlyKnownKeys(params, ["api_version", "chainId", "silent_mode"]) &&
  (params["silent_mode"] === undefined || typeof params["silent_mode"] === "boolean") &&
  isOptionalApiVersion(params["api_version"]) &&
  isHexChainId(params["chainId"])
    ? params["chainId"]
    : null;

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
type ResultMapper = (result: unknown) => ProviderPayload;
const failed = (): ProviderPayload => ({ error: unknownError() });
// The method-agnostic failures checked before per-method mapping: an `{ error }`
// string and a rejected `{ ok: false, pending }` envelope.
const readRuntimeFailure = (result: unknown): ProviderPayload | null => {
  if (!isRecord(result)) return null;
  if (typeof result["error"] === "string") return { error: errorForMessage(result["error"]) };
  return result["ok"] === false && isRecord(result["pending"]) ? failed() : null;
};
// `{ ok: true, [field]: T }` → `{ result: T }` (permissions, versions, balances…).
const okFieldPayload = <T>(
  result: unknown,
  field: string,
  parse: (value: unknown) => T | null,
): ProviderPayload => {
  const value = isRecord(result) && result["ok"] === true ? parse(result[field]) : null;
  return value ? { result: value } : failed();
};
// `{ ok: true, [flag]: true }` → `{ result: true }` (watchAsset, addStarknetChain).
const okFlagPayload = (result: unknown, flag: string): ProviderPayload =>
  isRecord(result) && result["ok"] === true && result[flag] === true ? { result: true } : failed();
// `{ ok: true, signature }` carries the account contract's ABI signature:
// OpenZeppelin `[r,s]`, or Argent Account `[1,0,publicKey,r,s]`. The fixed
// discriminants and every felt are checked here because the background result
// still crosses an extension-message boundary before it reaches the page.
const signaturePayload: ResultMapper = (result) => {
  const signature = isRecord(result) && result["ok"] === true ? result["signature"] : null;
  if (!Array.isArray(signature)) {
    return failed();
  }
  const isCanonicalSignatureFelt = (felt: unknown): felt is string =>
    typeof felt === "string" && isNonZeroStarkFieldElement(felt) && canonicalFelt(felt) === felt;
  const isOz = signature.length === 2 && signature.every(isCanonicalSignatureFelt);
  const isArgent =
    signature.length === 5 &&
    signature[0] === "1" &&
    signature[1] === "0" &&
    signature.slice(2).every(isCanonicalSignatureFelt);
  return isOz || isArgent ? { result: [...signature] } : failed();
};
// Validates the trusted account list (dapps never see indices or public keys).
const readAccountRefs = (result: unknown) =>
  parseAccountsResult(result, isAccountRef, (account) => account.id);
const accountsViewPayload: ResultMapper = (result) => {
  const accounts = readAccountRefs(result);
  return accounts ? { result: { accounts: accounts.map(toPublicAccount), ok: true } } : failed();
};
const accountsAddressesPayload: ResultMapper = (result) => {
  const accounts = readAccountRefs(result);
  return accounts ? { result: accounts.map((account) => account.address) } : failed();
};
// Methods after the chain-id branch yield the chain id for a chain-id envelope
// (original fall-through), else defer to their own tail.
const chainIdOr =
  (rest: ResultMapper): ResultMapper =>
  (result) => {
    const chainId = providerChainIdResult(result);
    return chainId ? { result: chainId.chainId } : rest(result);
  };
// A wallet hash that will not pad is UNKNOWN_ERROR; a non-invoke shape defers to
// the accounts tail (original fall-through). Same idea for declareTxPayload.
const invokeTxPayload: ResultMapper = (result) => {
  if (!isRecord(result) || typeof result["transactionHash"] !== "string") {
    return accountsViewPayload(result);
  }
  const hash = padFelt(result["transactionHash"]);
  return hash ? { result: { transaction_hash: hash } } : failed();
};
const declareTxPayload: ResultMapper = (result) => {
  if (
    !isRecord(result) ||
    typeof result["transactionHash"] !== "string" ||
    typeof result["classHash"] !== "string"
  ) {
    return accountsViewPayload(result);
  }
  const transactionHash = padFelt(result["transactionHash"]);
  const classHash = padFelt(result["classHash"]);
  return transactionHash && classHash
    ? { result: { class_hash: classHash, transaction_hash: transactionHash } }
    : failed();
};
// switch reports success (not the id) for a chain-id envelope, else the tail.
const switchChainPayload: ResultMapper = (result) =>
  providerChainIdResult(result) ? { result: true } : accountsViewPayload(result);
// One mapper per method, in the original if-chain's precedence; exhaustive.
const RESULT_MAPPERS: Record<ProviderResultMethod, ResultMapper> = {
  mc_accounts: chainIdOr(accountsViewPayload),
  mc_requestAccounts: chainIdOr(accountsViewPayload),
  mc_strk20Register: chainIdOr(invokeTxPayload),
  wallet_requestAccounts: chainIdOr(accountsAddressesPayload),
  wallet_requestChainId: chainIdOr(accountsViewPayload),
  wallet_switchStarknetChain: switchChainPayload,
  wallet_addInvokeTransaction: chainIdOr(invokeTxPayload),
  wallet_strk20InvokeTransaction: chainIdOr(invokeTxPayload),
  wallet_addDeclareTransaction: chainIdOr(declareTxPayload),
  wallet_addStarknetChain: chainIdOr((result) => okFlagPayload(result, "added")),
  wallet_deploymentData: deploymentPayload,
  wallet_watchAsset: (result) => okFlagPayload(result, "watched"),
  wallet_signTypedData: signaturePayload,
  wallet_getPermissions: (result) =>
    okFieldPayload(result, "permissions", providerStringArrayResult),
  wallet_supportedSpecs: (result) => okFieldPayload(result, "versions", providerStringArrayResult),
  wallet_supportedWalletApi: (result) =>
    okFieldPayload(result, "versions", providerStringArrayResult),
  wallet_strk20Balances: (result) => okFieldPayload(result, "balances", providerStrk20Balances),
  wallet_strk20PrepareInvoke: (result) =>
    okFieldPayload(result, "callAndProof", providerStrk20CallAndProof),
  wallet_strk20ShadowAccountCommitment: (result) =>
    okFieldPayload(result, "commitment", providerStrk20Commitment),
};

const resultMapperFor = (method: ProviderResultMethod): ResultMapper => {
  switch (method) {
    case "mc_accounts":
      return RESULT_MAPPERS.mc_accounts;
    case "mc_requestAccounts":
      return RESULT_MAPPERS.mc_requestAccounts;
    case "mc_strk20Register":
      return RESULT_MAPPERS.mc_strk20Register;
    case "wallet_addDeclareTransaction":
      return RESULT_MAPPERS.wallet_addDeclareTransaction;
    case "wallet_addInvokeTransaction":
      return RESULT_MAPPERS.wallet_addInvokeTransaction;
    case "wallet_deploymentData":
      return RESULT_MAPPERS.wallet_deploymentData;
    case "wallet_addStarknetChain":
      return RESULT_MAPPERS.wallet_addStarknetChain;
    case "wallet_getPermissions":
      return RESULT_MAPPERS.wallet_getPermissions;
    case "wallet_requestAccounts":
      return RESULT_MAPPERS.wallet_requestAccounts;
    case "wallet_requestChainId":
      return RESULT_MAPPERS.wallet_requestChainId;
    case "wallet_signTypedData":
      return RESULT_MAPPERS.wallet_signTypedData;
    case "wallet_supportedSpecs":
      return RESULT_MAPPERS.wallet_supportedSpecs;
    case "wallet_supportedWalletApi":
      return RESULT_MAPPERS.wallet_supportedWalletApi;
    case "wallet_strk20Balances":
      return RESULT_MAPPERS.wallet_strk20Balances;
    case "wallet_strk20InvokeTransaction":
      return RESULT_MAPPERS.wallet_strk20InvokeTransaction;
    case "wallet_strk20PrepareInvoke":
      return RESULT_MAPPERS.wallet_strk20PrepareInvoke;
    case "wallet_strk20ShadowAccountCommitment":
      return RESULT_MAPPERS.wallet_strk20ShadowAccountCommitment;
    case "wallet_switchStarknetChain":
      return RESULT_MAPPERS.wallet_switchStarknetChain;
    case "wallet_watchAsset":
      return RESULT_MAPPERS.wallet_watchAsset;
  }
};

/**
 * Converts background runtime results into provider success or rejection
 * payloads, mapping every failure to a spec `{ code, message, data? }` object.
 */
export const toProviderPayload = (
  result: unknown,
  method: ProviderResultMethod = "mc_accounts",
): ProviderPayload => readRuntimeFailure(result) ?? resultMapperFor(method)(result);
