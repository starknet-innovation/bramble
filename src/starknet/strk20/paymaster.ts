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
import { isNonZeroStarkFieldElement, isStarkFieldElement, sameFelt } from "../networks";
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

const paymasterCall = (call: Call): PaymasterCall => ({
  calldata: CallData.compile(call.calldata ?? []).map(String),
  selector: hash.getSelectorFromName(call.entrypoint),
  to: call.contractAddress,
});

const feeMode = (config: Strk20PaymasterConfig) => ({
  mode: "sponsored_private",
  pool_fee_token: config.feeToken,
  tip: "normal",
});

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
  const result = await rpc(input.http ?? fetch, input.config.url, "paymaster_buildTransaction", {
    parameters: { ...PARAMETERS, fee_mode: feeMode(input.config) },
    transaction: hasApprovals
      ? {
          apply_action: { pool_address: input.poolAddress },
          invoke: {
            calls: input.approveCalls.map(paymasterCall),
            user_address: input.accountAddress,
          },
          type: "invoke_and_apply_action",
        }
      : {
          apply_action: { pool_address: input.poolAddress },
          type: "apply_action",
        },
  });
  if (!isRecord(result) || !hasOnlyKnownKeys(result, ["fee_action", "typed_data"])) {
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
 * strictly validated before it reaches wallet activity state.
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
      user_address: input.accountAddress,
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
