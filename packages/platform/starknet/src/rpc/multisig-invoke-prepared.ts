/** Canonicalization and validation for frozen Argent multisig V3 invokes. */

import { WalletError } from "@mc-wallet/core/errors";
import { hasOnlyKnownKeys, isOwnDataProperty, isRecord } from "@mc-wallet/core/json";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
  UINT128_LIMIT,
} from "@mc-wallet/wallet-model/networks";
import type { EDataAvailabilityMode, ResourceBoundsBN } from "starknet";
import { hash, transaction } from "starknet";
import { type FeeEstimate, feeBoundsMaxSpend } from "./fee-bounds";
import {
  ARGENT_MULTISIG_INVOKE_LIMITS,
  type ArgentMultisigCall,
  type PreparedArgentMultisigCall,
  type PreparedArgentMultisigInvokeV3,
  type PreparedResourceBound,
  type PreparedResourceBounds,
} from "./multisig-invoke-types";

const ENTRYPOINT_PATTERN = /^[a-z_][A-Za-z0-9_]{0,63}$/;
const INTEGER_PATTERN = /^(?:0x[0-9a-fA-F]+|[0-9]+)$/;
const RESOURCE_AMOUNT_LIMIT = UINT128_LIMIT >> 64n;

const isDenseArray = (value: unknown): value is readonly unknown[] => {
  if (!Array.isArray(value)) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!isOwnDataProperty(Object.getOwnPropertyDescriptor(value, index))) {
      return false;
    }
  }
  return true;
};

/**
 * Canonicalizes an integer from an RPC or option boundary. It rejects coercive
 * JavaScript inputs and values at or above an optional exclusive limit.
 */
const canonicalArgentMultisigInteger = (value: unknown, label: string, limit?: bigint): string => {
  let numeric: bigint;
  if (typeof value === "bigint") {
    numeric = value;
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    numeric = BigInt(value);
  } else if (typeof value === "string" && INTEGER_PATTERN.test(value)) {
    numeric = BigInt(value);
  } else {
    throw new WalletError(`Invalid ${label}`);
  }
  if (numeric < 0n || (limit !== undefined && numeric >= limit)) {
    throw new WalletError(`Invalid ${label}`);
  }
  return `0x${numeric.toString(16)}`;
};

/**
 * Canonicalizes one Stark field input and optionally excludes zero. Malformed
 * inputs throw before they can reach hashing or RPC operations.
 */
export const canonicalArgentMultisigFelt = (
  value: unknown,
  label: string,
  nonZero = false,
): string => {
  const canonical = typeof value === "string" ? canonicalFelt(value) : null;
  if (
    canonical === null ||
    !isStarkFieldElement(canonical) ||
    (nonZero && !isNonZeroStarkFieldElement(canonical))
  ) {
    throw new WalletError(`Invalid ${label}`);
  }
  return canonical;
};

/**
 * Validates and canonicalizes the bounded public calls included in a prepared
 * transaction. Sparse arrays, unknown keys, and structured calldata fail.
 */
export const normalizeArgentMultisigCalls = (
  calls: readonly ArgentMultisigCall[],
): readonly PreparedArgentMultisigCall[] => {
  if (
    !Array.isArray(calls) ||
    calls.length < 1 ||
    calls.length > ARGENT_MULTISIG_INVOKE_LIMITS.calls ||
    !isDenseArray(calls)
  ) {
    throw new WalletError("Invalid Argent multisig calls");
  }
  let totalCalldata = 0;
  return calls.map((call) => {
    const rawCalldata = isRecord(call) ? (call["calldata"] ?? []) : null;
    if (
      !isRecord(call) ||
      !hasOnlyKnownKeys(call, ["calldata", "contractAddress", "entrypoint"]) ||
      !Object.hasOwn(call, "calldata") ||
      !Object.hasOwn(call, "contractAddress") ||
      !Object.hasOwn(call, "entrypoint") ||
      !Array.isArray(rawCalldata) ||
      rawCalldata.length > ARGENT_MULTISIG_INVOKE_LIMITS.calldataFelts ||
      !isDenseArray(rawCalldata) ||
      typeof call["entrypoint"] !== "string" ||
      !ENTRYPOINT_PATTERN.test(call["entrypoint"])
    ) {
      throw new WalletError("Invalid Argent multisig call");
    }
    const calldata = rawCalldata.map((entry) =>
      canonicalArgentMultisigFelt(entry, "Argent multisig calldata"),
    );
    totalCalldata += calldata.length;
    if (totalCalldata > ARGENT_MULTISIG_INVOKE_LIMITS.totalCalldataFelts) {
      throw new WalletError("Invalid Argent multisig calldata length");
    }
    return {
      calldata,
      contractAddress: canonicalArgentMultisigFelt(
        call["contractAddress"],
        "Argent multisig call address",
        true,
      ),
      entrypoint: call["entrypoint"],
    };
  });
};

const exactRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, keys) &&
  keys.every((key) => Object.hasOwn(value, key));

const normalizeResourceBound = (value: unknown): PreparedResourceBound => {
  const snake = ["max_amount", "max_price_per_unit"] as const;
  const camel = ["maxAmount", "maxPricePerUnit"] as const;
  if (exactRecord(value, snake)) {
    return {
      maxAmount: canonicalArgentMultisigInteger(
        value[snake[0]],
        "resource max amount",
        RESOURCE_AMOUNT_LIMIT,
      ),
      maxPricePerUnit: canonicalArgentMultisigInteger(
        value[snake[1]],
        "resource max price",
        UINT128_LIMIT,
      ),
    };
  }
  if (exactRecord(value, camel)) {
    return {
      maxAmount: canonicalArgentMultisigInteger(
        value[camel[0]],
        "resource max amount",
        RESOURCE_AMOUNT_LIMIT,
      ),
      maxPricePerUnit: canonicalArgentMultisigInteger(
        value[camel[1]],
        "resource max price",
        UINT128_LIMIT,
      ),
    };
  }
  throw new WalletError("Invalid Argent multisig resource bounds");
};

/**
 * Accepts exactly the three Starknet V3 resource lanes in either starknet.js
 * spelling, rejecting mixed, partial, or forward-unknown authority.
 */
export const normalizeArgentMultisigResourceBounds = (value: unknown): PreparedResourceBounds => {
  const snake = ["l1_data_gas", "l1_gas", "l2_gas"] as const;
  const camel = ["l1DataGas", "l1Gas", "l2Gas"] as const;
  if (exactRecord(value, snake)) {
    return {
      l1DataGas: normalizeResourceBound(value[snake[0]]),
      l1Gas: normalizeResourceBound(value[snake[1]]),
      l2Gas: normalizeResourceBound(value[snake[2]]),
    };
  }
  if (exactRecord(value, camel)) {
    return {
      l1DataGas: normalizeResourceBound(value[camel[0]]),
      l1Gas: normalizeResourceBound(value[camel[1]]),
      l2Gas: normalizeResourceBound(value[camel[2]]),
    };
  }
  throw new WalletError("Invalid Argent multisig resource bounds");
};

/**
 * Projects canonical stored bounds into the exact snake-case starknet.js RPC
 * shape. The caller must first validate or construct the prepared value.
 */
export const argentMultisigRpcResourceBounds = (
  bounds: PreparedResourceBounds,
): ResourceBoundsBN => ({
  l1_data_gas: {
    max_amount: BigInt(bounds.l1DataGas.maxAmount),
    max_price_per_unit: BigInt(bounds.l1DataGas.maxPricePerUnit),
  },
  l1_gas: {
    max_amount: BigInt(bounds.l1Gas.maxAmount),
    max_price_per_unit: BigInt(bounds.l1Gas.maxPricePerUnit),
  },
  l2_gas: {
    max_amount: BigInt(bounds.l2Gas.maxAmount),
    max_price_per_unit: BigInt(bounds.l2Gas.maxPricePerUnit),
  },
});

const daMode = (value: EDataAvailabilityMode): 0 | 1 => (value === "L2" ? 1 : 0);

/**
 * Recomputes the exact Starknet V3 invoke hash from frozen fields. It throws if
 * starknet.js ever returns an invalid transaction hash.
 */
export const argentMultisigTransactionHash = (
  prepared: Omit<PreparedArgentMultisigInvokeV3, "transactionHash">,
): string => {
  const computed = canonicalFelt(
    hash.calculateInvokeTransactionHash({
      accountDeploymentData: [...prepared.accountDeploymentData],
      chainId: prepared.chainId as Parameters<
        typeof hash.calculateInvokeTransactionHash
      >[0]["chainId"],
      compiledCalldata: [...prepared.calldata],
      feeDataAvailabilityMode: daMode(prepared.feeDataAvailabilityMode),
      nonce: prepared.nonce,
      nonceDataAvailabilityMode: daMode(prepared.nonceDataAvailabilityMode),
      paymasterData: [...prepared.paymasterData],
      resourceBounds: argentMultisigRpcResourceBounds(prepared.resourceBounds),
      senderAddress: prepared.senderAddress,
      tip: prepared.tip,
      version: prepared.version,
    }),
  );
  if (computed === null || !isNonZeroStarkFieldElement(computed)) {
    throw new WalletError("Invalid Argent multisig transaction hash");
  }
  return computed;
};

const isCanonicalFelt = (value: unknown): value is string =>
  typeof value === "string" && isStarkFieldElement(value) && canonicalFelt(value) === value;

/**
 * Strictly validates one canonical Argent multisig call. This predicate never
 * throws on hostile storage or message input.
 */
export const isArgentMultisigCall = (value: unknown): value is ArgentMultisigCall =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["calldata", "contractAddress", "entrypoint"]) &&
  Array.isArray(value["calldata"]) &&
  value["calldata"].length <= ARGENT_MULTISIG_INVOKE_LIMITS.calldataFelts &&
  isDenseArray(value["calldata"]) &&
  value["calldata"].every(isCanonicalFelt) &&
  isCanonicalFelt(value["contractAddress"]) &&
  isNonZeroStarkFieldElement(value["contractAddress"]) &&
  typeof value["entrypoint"] === "string" &&
  ENTRYPOINT_PATTERN.test(value["entrypoint"]);

/**
 * Strictly validates one bounded canonical Argent multisig multicall. This
 * predicate never throws on hostile storage or message input.
 */
export const isArgentMultisigCalls = (value: unknown): value is readonly ArgentMultisigCall[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= ARGENT_MULTISIG_INVOKE_LIMITS.calls &&
  isDenseArray(value) &&
  value.every(isArgentMultisigCall) &&
  value.reduce((count, call) => count + call.calldata.length, 0) <=
    ARGENT_MULTISIG_INVOKE_LIMITS.totalCalldataFelts;

const isPreparedResourceBound = (value: unknown): value is PreparedResourceBound =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["maxAmount", "maxPricePerUnit"]) &&
  isCanonicalFelt(value["maxAmount"]) &&
  BigInt(value["maxAmount"]) < RESOURCE_AMOUNT_LIMIT &&
  isCanonicalFelt(value["maxPricePerUnit"]) &&
  BigInt(value["maxPricePerUnit"]) < UINT128_LIMIT;

const isPreparedResourceBounds = (value: unknown): value is PreparedResourceBounds =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["l1DataGas", "l1Gas", "l2Gas"]) &&
  isPreparedResourceBound(value["l1DataGas"]) &&
  isPreparedResourceBound(value["l1Gas"]) &&
  isPreparedResourceBound(value["l2Gas"]);

/**
 * Strictly validates stored frozen fields and recomputes their V3 hash. This
 * predicate never throws on hostile storage or message input.
 */
export const isPreparedArgentMultisigInvokeV3 = (
  value: unknown,
): value is PreparedArgentMultisigInvokeV3 => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "accountDeploymentData",
      "calldata",
      "calls",
      "chainId",
      "feeDataAvailabilityMode",
      "nonce",
      "nonceDataAvailabilityMode",
      "paymasterData",
      "resourceBounds",
      "senderAddress",
      "tip",
      "transactionHash",
      "version",
    ]) ||
    value["version"] !== "0x3" ||
    !isArgentMultisigCalls(value["calls"]) ||
    !Array.isArray(value["calldata"]) ||
    value["calldata"].length > ARGENT_MULTISIG_INVOKE_LIMITS.executeCalldataFelts ||
    !isDenseArray(value["calldata"]) ||
    !value["calldata"].every(isCanonicalFelt) ||
    !Array.isArray(value["accountDeploymentData"]) ||
    value["accountDeploymentData"].length !== 0 ||
    !isDenseArray(value["accountDeploymentData"]) ||
    !Array.isArray(value["paymasterData"]) ||
    value["paymasterData"].length !== 0 ||
    !isDenseArray(value["paymasterData"]) ||
    !isCanonicalFelt(value["chainId"]) ||
    !isCanonicalFelt(value["nonce"]) ||
    !isCanonicalFelt(value["senderAddress"]) ||
    !isNonZeroStarkFieldElement(value["senderAddress"]) ||
    value["tip"] !== "0x0" ||
    !isPreparedResourceBounds(value["resourceBounds"]) ||
    value["nonceDataAvailabilityMode"] !== "L1" ||
    value["feeDataAvailabilityMode"] !== "L1" ||
    !isCanonicalFelt(value["transactionHash"]) ||
    !isNonZeroStarkFieldElement(value["transactionHash"])
  ) {
    return false;
  }
  const prepared = value as PreparedArgentMultisigInvokeV3;
  try {
    const compiled = transaction
      .getExecuteCalldata(
        prepared.calls.map((call) => ({ ...call, calldata: [...call.calldata] })),
        "1",
      )
      .map((entry) => canonicalFelt(entry));
    return (
      compiled.every((entry): entry is string => entry !== null) &&
      compiled.length === prepared.calldata.length &&
      compiled.every((entry, index) => entry === prepared.calldata[index]) &&
      sameFelt(argentMultisigTransactionHash(prepared), prepared.transactionHash)
    );
  } catch {
    return false;
  }
};

/**
 * Returns the maximum FRI spend authorised by a validated frozen transaction.
 * It throws on malformed data and never re-estimates or uses a headline fee.
 */
export const preparedArgentMultisigFee = (
  prepared: PreparedArgentMultisigInvokeV3,
): FeeEstimate => {
  if (!isPreparedArgentMultisigInvokeV3(prepared)) {
    throw new WalletError("Invalid prepared Argent multisig transaction");
  }
  const bounds = prepared.resourceBounds;
  const spend = feeBoundsMaxSpend({
    l1_data_gas: {
      max_amount: bounds.l1DataGas.maxAmount,
      max_price_per_unit: bounds.l1DataGas.maxPricePerUnit,
    },
    l1_gas: {
      max_amount: bounds.l1Gas.maxAmount,
      max_price_per_unit: bounds.l1Gas.maxPricePerUnit,
    },
    l2_gas: {
      max_amount: bounds.l2Gas.maxAmount,
      max_price_per_unit: bounds.l2Gas.maxPricePerUnit,
    },
  });
  if (spend === null) {
    throw new WalletError("Invalid prepared Argent multisig resource bounds");
  }
  return { overallFee: spend.toString(), unit: "FRI" };
};

/**
 * Compares two validated frozen transactions without accepting alternate field
 * encodings. Malformed values simply compare unequal.
 */
export const samePreparedArgentMultisigInvokeV3 = (
  left: PreparedArgentMultisigInvokeV3,
  right: PreparedArgentMultisigInvokeV3,
): boolean =>
  isPreparedArgentMultisigInvokeV3(left) &&
  isPreparedArgentMultisigInvokeV3(right) &&
  JSON.stringify([
    left.accountDeploymentData,
    left.calldata,
    left.calls.map((call) => [call.contractAddress, call.entrypoint, call.calldata]),
    left.chainId,
    left.feeDataAvailabilityMode,
    left.nonce,
    left.nonceDataAvailabilityMode,
    left.paymasterData,
    [left.resourceBounds.l1DataGas.maxAmount, left.resourceBounds.l1DataGas.maxPricePerUnit],
    [left.resourceBounds.l1Gas.maxAmount, left.resourceBounds.l1Gas.maxPricePerUnit],
    [left.resourceBounds.l2Gas.maxAmount, left.resourceBounds.l2Gas.maxPricePerUnit],
    left.senderAddress,
    left.tip,
    left.transactionHash,
    left.version,
  ]) ===
    JSON.stringify([
      right.accountDeploymentData,
      right.calldata,
      right.calls.map((call) => [call.contractAddress, call.entrypoint, call.calldata]),
      right.chainId,
      right.feeDataAvailabilityMode,
      right.nonce,
      right.nonceDataAvailabilityMode,
      right.paymasterData,
      [right.resourceBounds.l1DataGas.maxAmount, right.resourceBounds.l1DataGas.maxPricePerUnit],
      [right.resourceBounds.l1Gas.maxAmount, right.resourceBounds.l1Gas.maxPricePerUnit],
      [right.resourceBounds.l2Gas.maxAmount, right.resourceBounds.l2Gas.maxPricePerUnit],
      right.senderAddress,
      right.tip,
      right.transactionHash,
      right.version,
    ]);
