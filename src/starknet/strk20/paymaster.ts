/**
 * Strict JSON-RPC client for the privacy paymaster's sponsored-private flow.
 * No API key is accepted: shared credentials cannot be protected in an
 * extension bundle, so authenticated deployments must expose a wallet-owned
 * relay instead.
 */

import type { Call } from "starknet";
import { CallData, hash } from "starknet";
import { WalletError } from "../../shared/errors";
import { hasOnlyKnownKeys, isRecord } from "../../shared/json";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
} from "../networks";
import type { Strk20PaymasterConfig } from "./config";
import { bindPaymasterTypedData, isPaymasterAuthorizationLive } from "./paymaster-typed-data";
import type { Strk20Proof } from "./schemas";
import { STRK20_SUBMISSION_UNAVAILABLE, type Strk20PrivateRelayPlan } from "./service";

type PaymasterCall = {
  readonly calldata: readonly string[];
  readonly selector: string;
  readonly to: string;
};

type PaymasterHttp = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const PARAMETERS = { version: "0x1" } as const;
const PAYMASTER_TIMEOUT_MS = 30_000;
const MAX_PAYMASTER_RESPONSE_BYTES = 1024 * 1024;

const requirePaymasterFelt = (value: string, allowZero: boolean): string => {
  const canonical = canonicalFelt(value);
  if (
    canonical === null ||
    (allowZero ? !isStarkFieldElement(canonical) : !isNonZeroStarkFieldElement(canonical))
  ) {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  return canonical;
};

// AVNU's paymaster OpenRPC schema accepts felts only as canonical 0x-prefixed
// hex strings. CallData.compile returns decimal strings, so normalize every
// call field at this trust boundary rather than relying on caller formatting.
const paymasterCall = (call: Call): PaymasterCall => {
  try {
    return {
      calldata: CallData.compile(call.calldata ?? []).map((felt) =>
        requirePaymasterFelt(String(felt), true),
      ),
      selector: requirePaymasterFelt(hash.getSelectorFromName(call.entrypoint), false),
      to: requirePaymasterFelt(call.contractAddress, false),
    };
  } catch {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
};

const feeMode = (config: Strk20PaymasterConfig) => ({
  mode: "sponsored_private",
  pool_fee_token: requirePaymasterFelt(config.feeToken, false),
  tip: "normal",
});

const QUOTE_KEYS = ["fee", "fee_action", "parameters", "type", "typed_data"] as const;
const FEE_KEYS = [
  "estimated_fee_in_gas_token",
  "estimated_fee_in_strk",
  "gas_token_price_in_strk",
  "suggested_max_fee_in_gas_token",
  "suggested_max_fee_in_strk",
] as const;
const REQUIRED_FEE_KEYS = [
  "estimated_fee_in_strk",
  "gas_token_price_in_strk",
  "suggested_max_fee_in_strk",
] as const;

// The current OpenRPC response includes both gas-token fields. The deployed
// sponsored-private service can omit that pair when STRK is also the fee token;
// accept only those two complete, observed shapes so a partial estimate fails.
const isQuoteFee = (value: unknown): boolean => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, FEE_KEYS)) {
    return false;
  }
  if (
    !REQUIRED_FEE_KEYS.every(
      (key) =>
        Object.hasOwn(value, key) &&
        typeof value[key] === "string" &&
        isStarkFieldElement(value[key]),
    )
  ) {
    return false;
  }
  const hasEstimatedGasToken = Object.hasOwn(value, "estimated_fee_in_gas_token");
  const hasSuggestedGasToken = Object.hasOwn(value, "suggested_max_fee_in_gas_token");
  return (
    hasEstimatedGasToken === hasSuggestedGasToken &&
    (!hasEstimatedGasToken ||
      (typeof value["estimated_fee_in_gas_token"] === "string" &&
        isStarkFieldElement(value["estimated_fee_in_gas_token"]) &&
        typeof value["suggested_max_fee_in_gas_token"] === "string" &&
        isStarkFieldElement(value["suggested_max_fee_in_gas_token"])))
  );
};

// Execution parameters are an informational echo, but validating any echoed
// values prevents a route or fee-token mismatch from being hidden in a quote.
// Older deployed responses omit defaulted fee-mode fields; present fields must
// still match the request exactly.
const isQuoteParameters = (value: unknown, feeToken: string): boolean => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["fee_mode", "time_bounds", "version"]) ||
    value["version"] !== PARAMETERS.version ||
    (value["time_bounds"] !== undefined && value["time_bounds"] !== null)
  ) {
    return false;
  }
  const mode = value["fee_mode"];
  return (
    isRecord(mode) &&
    hasOnlyKnownKeys(mode, ["mode", "pool_fee_token", "tip"]) &&
    mode["mode"] === "sponsored_private" &&
    (mode["pool_fee_token"] === undefined || sameFelt(mode["pool_fee_token"], feeToken)) &&
    (mode["tip"] === undefined || mode["tip"] === "normal")
  );
};

const readBoundedResponse = async (response: Response): Promise<string | null> => {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > MAX_PAYMASTER_RESPONSE_BYTES)
  ) {
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > MAX_PAYMASTER_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

const rpc = async (
  http: PaymasterHttp,
  url: string,
  method: string,
  params: unknown,
): Promise<unknown> => {
  let response: Response;
  try {
    response = await http(url, {
      body: JSON.stringify({ id: "mc-wallet-strk20", jsonrpc: "2.0", method, params }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(PAYMASTER_TIMEOUT_MS),
    });
  } catch {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  if (!response.ok) {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  let body: unknown;
  try {
    const text = await readBoundedResponse(response);
    if (text === null) {
      throw new Error("invalid response");
    }
    body = JSON.parse(text);
  } catch {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  if (
    !isRecord(body) ||
    !hasOnlyKnownKeys(body, ["error", "id", "jsonrpc", "result"]) ||
    body["jsonrpc"] !== "2.0" ||
    body["id"] !== "mc-wallet-strk20" ||
    body["error"] !== undefined ||
    !Object.hasOwn(body, "result")
  ) {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  return body["result"];
};

const readFeeAction = (value: unknown): Strk20PrivateRelayPlan["feeAction"] | null =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["amount", "recipient", "token", "type"]) &&
  value["type"] === "withdraw" &&
  typeof value["amount"] === "string" &&
  isStarkFieldElement(value["amount"]) &&
  typeof value["recipient"] === "string" &&
  isNonZeroStarkFieldElement(value["recipient"]) &&
  typeof value["token"] === "string" &&
  isNonZeroStarkFieldElement(value["token"])
    ? {
        amount: value["amount"],
        recipient: value["recipient"],
        token: value["token"],
        type: "withdraw",
      }
    : null;

/**
 * Requests the fee action and, when deposits require public approvals, freezes
 * the paymaster typed data and its account signature.
 */
export const buildStrk20PaymasterPlan = async (input: {
  readonly accountAddress: string;
  readonly approveCalls: readonly Call[];
  readonly chainId: string;
  readonly config: Strk20PaymasterConfig;
  readonly http?: PaymasterHttp;
  readonly nowSeconds: number;
  readonly poolAddress: string;
}): Promise<Strk20PrivateRelayPlan> => {
  const hasApprovals = input.approveCalls.length > 0;
  const expectedType = hasApprovals ? "invoke_and_apply_action" : "apply_action";
  const result = await rpc(input.http ?? fetch, input.config.url, "paymaster_buildTransaction", {
    parameters: { ...PARAMETERS, fee_mode: feeMode(input.config) },
    transaction: hasApprovals
      ? {
          apply_action: { pool_address: requirePaymasterFelt(input.poolAddress, false) },
          invoke: {
            calls: input.approveCalls.map(paymasterCall),
            user_address: requirePaymasterFelt(input.accountAddress, false),
          },
          type: expectedType,
        }
      : {
          apply_action: { pool_address: requirePaymasterFelt(input.poolAddress, false) },
          type: expectedType,
        },
  });
  if (
    !isRecord(result) ||
    !hasOnlyKnownKeys(result, QUOTE_KEYS) ||
    result["type"] !== expectedType ||
    !Object.hasOwn(result, "parameters") ||
    !isQuoteParameters(result["parameters"], input.config.feeToken) ||
    !Object.hasOwn(result, "fee") ||
    !isQuoteFee(result["fee"]) ||
    !Object.hasOwn(result, "fee_action") ||
    hasApprovals !== Object.hasOwn(result, "typed_data")
  ) {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  const feeAction = readFeeAction(result["fee_action"]);
  const boundTypedData = hasApprovals
    ? bindPaymasterTypedData({
        accountAddress: input.accountAddress,
        calls: input.approveCalls,
        chainId: input.chainId,
        nowSeconds: input.nowSeconds,
        value: result["typed_data"],
      })
    : undefined;
  if (!feeAction || !sameFelt(feeAction.token, input.config.feeToken)) {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  if (!hasApprovals) {
    return { feeAction, mode: "private-relay" };
  }
  if (!boundTypedData) {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  return {
    authorization: boundTypedData.review,
    feeAction,
    mode: "private-relay",
    typedData: boundTypedData.typedData,
  };
};

/**
 * Submits the frozen proof and paymaster plan. The returned transaction hash is
 * strictly validated before it reaches wallet activity state. Public typed
 * data and its reviewed authorization are an inseparable, fail-closed pair.
 */
export const submitStrk20PaymasterPlan = async (input: {
  readonly accountAddress: string;
  readonly call: Call;
  readonly config: Strk20PaymasterConfig;
  readonly http?: PaymasterHttp;
  readonly nowSeconds: number;
  readonly plan: Strk20PrivateRelayPlan;
  readonly proof: Strk20Proof;
  readonly signTypedData: (typedData: unknown) => Promise<readonly string[]>;
}): Promise<{ readonly transactionHash: string }> => {
  const authorization = input.plan.authorization;
  const typedData = input.plan.typedData;
  if ((authorization === undefined) !== (typedData === undefined)) {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  let invoke:
    | {
        readonly signature: readonly string[];
        readonly typed_data: unknown;
        readonly user_address: string;
      }
    | undefined;
  if (typedData !== undefined && authorization !== undefined) {
    if (!isPaymasterAuthorizationLive(authorization, input.nowSeconds, 10n)) {
      throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
    }
    invoke = {
      signature: await input.signTypedData(typedData),
      typed_data: typedData,
      user_address: requirePaymasterFelt(input.accountAddress, false),
    };
  }
  const result = await rpc(input.http ?? fetch, input.config.url, "paymaster_executeTransaction", {
    parameters: { ...PARAMETERS, fee_mode: feeMode(input.config) },
    transaction: {
      apply_action: {
        apply_actions_call: paymasterCall(input.call),
        proof: input.proof.data,
        proof_facts: input.proof.proof_facts,
      },
      ...(invoke ? { invoke } : {}),
      type: invoke ? "invoke_and_apply_action" : "apply_action",
    },
  });
  if (
    !isRecord(result) ||
    !hasOnlyKnownKeys(result, ["transaction_hash"]) ||
    typeof result["transaction_hash"] !== "string" ||
    !isNonZeroStarkFieldElement(result["transaction_hash"])
  ) {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  return { transactionHash: result["transaction_hash"] };
};
