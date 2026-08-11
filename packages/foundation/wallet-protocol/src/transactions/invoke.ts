/**
 * Bounded provider invoke-parameter parsing at the page trust boundary.
 */
import { hasOnlyKnownKeys, isRecord, type Json } from "@mc-wallet/core/json";
import { canonicalFelt, isStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import { isStrk20Proof, type Strk20Proof } from "../privacy/strk20";
import { INVOKE_LIMITS } from "./invoke-limits";

/**
 * Internal camelCase call shape the background consumes for an invoke.
 */
export type ProviderInvokeCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

/**
 * Parsed invoke request, including optional STRK20 proof material.
 */
export type ProviderInvokeRequest = {
  readonly calls: readonly ProviderInvokeCall[];
  readonly proof?: Strk20Proof;
};

const toCalldataFelt = (value: unknown): string | null => {
  if (typeof value === "bigint" && value >= 0n) {
    const felt = `0x${value.toString(16)}`;
    return isStarkFieldElement(felt) ? felt : null;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    const felt = `0x${BigInt(value).toString(16)}`;
    return isStarkFieldElement(felt) ? felt : null;
  }
  if (typeof value !== "string" || value.length > INVOKE_LIMITS.feltCharacters) {
    return null;
  }
  const felt = canonicalFelt(value);
  return felt && isStarkFieldElement(felt) ? felt : null;
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
  if (
    contractAddress === null ||
    !isStarkFieldElement(contractAddress) ||
    BigInt(contractAddress) === 0n ||
    entrypoint === null ||
    entrypoint.length > INVOKE_LIMITS.entrypointCharacters ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entrypoint) ||
    !Array.isArray(calldata) ||
    calldata.length > INVOKE_LIMITS.calldataFelts
  ) {
    return null;
  }
  const felts = calldata.map(toCalldataFelt);
  if (!felts.every((item): item is string => item !== null)) {
    return null;
  }
  return { calldata: felts, contractAddress, entrypoint };
};

/**
 * Parses invoke params in spec or legacy shape. The exact call/calldata limits
 * are enforced before mapping, and malformed inputs fail closed as `null`.
 */
export const providerInvokeRequest = (params: Json | undefined): ProviderInvokeRequest | null => {
  if (
    !isRecord(params) ||
    !hasOnlyKnownKeys(params, ["calls", "invoke_transaction", "proof"]) ||
    (Object.hasOwn(params, "calls") && Object.hasOwn(params, "invoke_transaction"))
  ) {
    return null;
  }
  const source = params["invoke_transaction"] ?? params["calls"];
  if (!Array.isArray(source) || source.length === 0 || source.length > INVOKE_LIMITS.calls) {
    return null;
  }
  const calls = source.map(readInvokeCall);
  if (!calls.every((call): call is ProviderInvokeCall => call !== null)) {
    return null;
  }
  const proof = params["proof"];
  if (proof !== undefined && !isStrk20Proof(proof)) {
    return null;
  }
  return { calls, ...(proof === undefined ? {} : { proof }) };
};

/**
 * Compatibility helper for callers that only need the validated call list.
 */
export const providerInvokeCalls = (
  params: Json | undefined,
): readonly ProviderInvokeCall[] | null => providerInvokeRequest(params)?.calls ?? null;
