/**
 * Checks a gasless `buildTransaction` typed-data body before anything is
 * signed. The body is untrusted. It is accepted only when it is already the
 * SNIP-9 v2 shape the gateway requires (shortstring chain id, revision-1
 * types, `0x` felts), its calls are the user's calls plus one fee transfer
 * to the pinned forwarder, and that transfer is within the quoted maximum
 * and the independent ceiling. The hash check uses the pinned starknet.js
 * outside-execution builder. The original body is what a later execute posts;
 * the rebuild is not.
 */

import { isRecord } from "@bramble/core/json";
import { outsideExecutionCalls } from "@bramble/transactions/outside-execution-calls";
import { OUTSIDE_EXECUTION_DOMAIN } from "@bramble/transactions/outside-execution-terms";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
  uint256Felts,
} from "@bramble/wallet-model/networks";
import {
  type Call,
  CallData,
  hash,
  OutsideExecutionTypesV2,
  OutsideExecutionVersion,
  outsideExecution,
  type TypedData,
  typedData,
} from "starknet";
import { isPaymasterAuthorizationLive } from "./paymaster-typed-data";

/**
 * Longest execution window this wallet will sign. A longer `Execute Before`
 * would leave a lost reply executable long after Activity could show it.
 */
export const GASLESS_MAX_WINDOW_SECONDS = 600n;

/**
 * Why a gasless typed-data body was refused. `ceiling` means the fee transfer
 * is above the quoted maximum or the independent price ceiling.
 */
export type GaslessTypedDataReason = "calls" | "ceiling" | "forwarder" | "shape" | "window";

/**
 * A body that may be signed and posted unchanged.
 */
export type AcceptedGaslessTypedData = {
  readonly caller: string;
  readonly executeAfter: string;
  readonly executeBefore: string;
  readonly feeAmount: bigint;
  readonly ok: true;
  readonly typedData: unknown;
};

/**
 * A body that must not be signed.
 */
export type RefusedGaslessTypedData = {
  readonly ok: false;
  readonly reason: GaslessTypedDataReason;
};

const U64_LIMIT = 1n << 64n;
const MESSAGE_FIELDS = ["Caller", "Nonce", "Execute After", "Execute Before", "Calls"] as const;
const DOMAIN_FIELDS = ["chainId", "name", "revision", "version"] as const;
const CALL_FIELDS = ["Calldata", "Selector", "To"] as const;

const sameJson = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
  );
};

const hasKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};

const isHexFelt = (value: unknown): value is string =>
  typeof value === "string" && isStarkFieldElement(value);

const isU64Felt = (value: unknown): value is string =>
  isHexFelt(value) && BigInt(value) < U64_LIMIT;

const selectorOf = (entrypoint: string): string | null => {
  try {
    const hashed = isStarkFieldElement(entrypoint)
      ? canonicalFelt(entrypoint)
      : canonicalFelt(hash.getSelectorFromName(entrypoint));
    return hashed !== null && isStarkFieldElement(hashed) ? hashed : null;
  } catch {
    return null;
  }
};

const compiledCalldata = (calldata: Call["calldata"]): readonly string[] | null => {
  let compiled: readonly unknown[];
  try {
    compiled = CallData.compile(calldata ?? []);
  } catch {
    return null;
  }
  const felts: string[] = [];
  for (const item of compiled) {
    const canonical = canonicalFelt(String(item));
    if (canonical === null || !isStarkFieldElement(canonical)) {
      return null;
    }
    felts.push(canonical);
  }
  return felts;
};

type ParsedCall = {
  readonly calldata: readonly string[];
  readonly selector: string;
  readonly to: string;
};

const parseOneCall = (call: unknown): ParsedCall | null => {
  if (!isRecord(call) || !hasKeys(call, CALL_FIELDS) || !Array.isArray(call["Calldata"])) {
    return null;
  }
  if (
    !isHexFelt(call["To"]) ||
    !isNonZeroStarkFieldElement(call["To"]) ||
    !isHexFelt(call["Selector"]) ||
    !call["Calldata"].every(isHexFelt)
  ) {
    return null;
  }
  const to = canonicalFelt(call["To"]);
  const selector = canonicalFelt(call["Selector"]);
  const calldata = call["Calldata"].map((item) => canonicalFelt(item));
  if (to === null || selector === null || calldata.some((item) => item === null)) {
    return null;
  }
  return { calldata: calldata as string[], selector, to };
};

const parsedCalls = (message: Record<string, unknown>): readonly ParsedCall[] | null => {
  const calls = message["Calls"];
  if (!Array.isArray(calls) || calls.length === 0) {
    return null;
  }
  const parsed = calls.map(parseOneCall);
  return parsed.every((call) => call !== null) ? parsed : null;
};

const userCallMatches = (parsed: ParsedCall, call: Call): boolean => {
  const selector = selectorOf(call.entrypoint);
  const calldata = compiledCalldata(call.calldata);
  const to = canonicalFelt(call.contractAddress);
  if (selector === null || calldata === null || to === null || !sameFelt(parsed.to, to)) {
    return false;
  }
  return (
    sameFelt(parsed.selector, selector) &&
    parsed.calldata.length === calldata.length &&
    parsed.calldata.every((felt, index) => sameFelt(felt, calldata[index] ?? ""))
  );
};

const TRANSFER_SELECTOR = canonicalFelt(hash.getSelectorFromName("transfer"));

const domainMatches = (domain: Record<string, unknown>, chainId: string): boolean =>
  domain["name"] === OUTSIDE_EXECUTION_DOMAIN &&
  domain["version"] === "2" &&
  domain["revision"] === "1" &&
  domain["chainId"] === chainId;

const shapedMessage = (value: unknown, chainId: string): Record<string, unknown> | null => {
  if (!isRecord(value) || !hasKeys(value, ["domain", "message", "primaryType", "types"])) {
    return null;
  }
  const domain = value["domain"];
  const message = value["message"];
  if (
    value["primaryType"] !== "OutsideExecution" ||
    !sameJson(value["types"], OutsideExecutionTypesV2) ||
    !isRecord(domain) ||
    !isRecord(message) ||
    !hasKeys(domain, DOMAIN_FIELDS) ||
    !hasKeys(message, MESSAGE_FIELDS) ||
    !domainMatches(domain, chainId)
  ) {
    return null;
  }
  if (
    !isHexFelt(message["Caller"]) ||
    !isNonZeroStarkFieldElement(message["Caller"]) ||
    !isHexFelt(message["Nonce"]) ||
    !isU64Felt(message["Execute After"]) ||
    !isU64Felt(message["Execute Before"])
  ) {
    return null;
  }
  return message;
};

/**
 * Whether the outside-execution window is still live and no longer than
 * {@link GASLESS_MAX_WINDOW_SECONDS}. False when the clock or the bounds
 * cannot be read.
 */
export const gaslessAuthorizationWindow = (
  executeAfter: string,
  executeBefore: string,
  nowSeconds: number,
  minimumRemainingSeconds: bigint,
): boolean => {
  if (
    !isPaymasterAuthorizationLive(
      { caller: "0x1", executeAfter, executeBefore, publicCallCount: 1 },
      nowSeconds,
      minimumRemainingSeconds,
    )
  ) {
    return false;
  }
  try {
    return BigInt(executeBefore) - BigInt(nowSeconds) <= GASLESS_MAX_WINDOW_SECONDS;
  } catch {
    return false;
  }
};

const matchingFeeCall = (
  calls: readonly ParsedCall[],
  userCalls: readonly Call[],
): ParsedCall | null => {
  const fee = calls.length === userCalls.length + 1 ? calls[calls.length - 1] : undefined;
  if (fee === undefined) {
    return null;
  }
  const matches = calls.slice(0, userCalls.length).every((parsed, index) => {
    const call = userCalls[index];
    return call !== undefined && userCallMatches(parsed, call);
  });
  return matches ? fee : null;
};

const feeAmountOf = (
  fee: ParsedCall,
  forwarder: string,
  gasToken: string,
  quotedMax: bigint,
  ceiling: bigint,
): bigint | GaslessTypedDataReason => {
  const token = canonicalFelt(gasToken);
  if (
    token === null ||
    !sameFelt(fee.to, token) ||
    !sameFelt(fee.selector, TRANSFER_SELECTOR ?? "") ||
    fee.calldata.length !== 3
  ) {
    return "calls";
  }
  const amount = uint256Felts(fee.calldata[1], fee.calldata[2]);
  const recipient = fee.calldata[0];
  if (
    recipient === undefined ||
    !sameFelt(recipient, forwarder) ||
    amount === null ||
    amount <= 0n
  ) {
    return "calls";
  }
  return amount > quotedMax || amount > ceiling ? "ceiling" : amount;
};

const hashesMatch = (
  value: unknown,
  accountAddress: string,
  chainId: "SN_MAIN" | "SN_SEPOLIA",
  message: Record<string, unknown>,
  caller: string,
  calls: readonly Call[],
  fee: ParsedCall,
): boolean => {
  const rebuilt = outsideExecution.getTypedData(
    chainId,
    {
      caller,
      execute_after: message["Execute After"] as string,
      execute_before: message["Execute Before"] as string,
    },
    message["Nonce"] as string,
    [...calls, { calldata: [...fee.calldata], contractAddress: fee.to, entrypoint: "transfer" }],
    OutsideExecutionVersion.V2,
  );
  const supplied = typedData.getMessageHash(value as TypedData, accountAddress);
  return sameFelt(supplied, typedData.getMessageHash(rebuilt, accountAddress));
};

/**
 * Accepts AVNU's typed data or explains the refusal. `forwarder` is the
 * pinned address, never a value read from the quote. `ceiling` is the
 * independent maximum in the fee token's base units. `minimumRemainingSeconds`
 * is the live-window floor, ten seconds on the path that is about to sign.
 */
export const validateGaslessTypedData = (input: {
  readonly accountAddress: string;
  readonly calls: readonly Call[];
  readonly ceiling: bigint;
  readonly chainId: "SN_MAIN" | "SN_SEPOLIA";
  readonly forwarder: string;
  readonly gasToken: string;
  readonly minimumRemainingSeconds: bigint;
  readonly nowSeconds: number;
  readonly quotedMax: bigint;
  readonly value: unknown;
}): AcceptedGaslessTypedData | RefusedGaslessTypedData => {
  const refused = (reason: GaslessTypedDataReason): RefusedGaslessTypedData => ({
    ok: false,
    reason,
  });
  if (
    !isNonZeroStarkFieldElement(input.forwarder) ||
    !isNonZeroStarkFieldElement(input.gasToken) ||
    !isNonZeroStarkFieldElement(input.accountAddress) ||
    input.calls.length === 0 ||
    TRANSFER_SELECTOR === null
  ) {
    return refused("forwarder");
  }
  const message = shapedMessage(input.value, input.chainId);
  const calls = message === null ? null : parsedCalls(message);
  const readable = outsideExecutionCalls(input.value);
  if (
    message === null ||
    calls === null ||
    !Array.isArray(readable) ||
    readable.length !== calls.length
  ) {
    return refused("shape");
  }
  const caller = canonicalFelt(message["Caller"] as string);
  if (caller === null || !sameFelt(caller, input.forwarder)) {
    return refused("forwarder");
  }
  if (
    !gaslessAuthorizationWindow(
      message["Execute After"] as string,
      message["Execute Before"] as string,
      input.nowSeconds,
      input.minimumRemainingSeconds,
    )
  ) {
    return refused("window");
  }
  const fee = matchingFeeCall(calls, input.calls);
  if (fee === null) {
    return refused("calls");
  }
  const amount = feeAmountOf(fee, input.forwarder, input.gasToken, input.quotedMax, input.ceiling);
  if (typeof amount !== "bigint") {
    return refused(amount);
  }
  try {
    if (
      !hashesMatch(
        input.value,
        input.accountAddress,
        input.chainId,
        message,
        caller,
        input.calls,
        fee,
      )
    ) {
      return refused("calls");
    }
  } catch {
    return refused("shape");
  }
  return {
    caller,
    executeAfter: message["Execute After"] as string,
    executeBefore: message["Execute Before"] as string,
    feeAmount: amount,
    ok: true,
    typedData: input.value,
  };
};
