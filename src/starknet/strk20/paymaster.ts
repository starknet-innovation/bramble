/**
 * Strict JSON-RPC client for the privacy paymaster's sponsored-private flow.
 * No API key is accepted: shared credentials cannot be protected in an
 * extension bundle, so authenticated deployments must expose a wallet-owned
 * relay instead.
 */

import type { Call } from "starknet";
import { CallData, hash, num } from "starknet";
import { WalletError } from "../../shared/errors";
import { hasOnlyKnownKeys, isRecord } from "../../shared/json";
import { isNonZeroStarkFieldElement, isStarkFieldElement, sameFelt } from "../networks";
import type { Strk20PaymasterConfig } from "./config";
import { sanitizeStrk20Detail } from "./official-sdk-errors";
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

// The relay parses every felt as a 0x-prefixed hex string, while
// `CallData.compile` emits decimal — sending its output verbatim is rejected
// as "expected hex string to be prefixed by '0x'" before any signing happens.
const paymasterCall = (call: Call): PaymasterCall => ({
  calldata: CallData.compile(call.calldata ?? []).map((felt) => num.toHex(felt)),
  selector: hash.getSelectorFromName(call.entrypoint),
  to: num.toHex(call.contractAddress),
});

// Keys a `paymaster_buildTransaction` result may carry. Only `fee_action` and
// `typed_data` are consumed; `type`, `parameters`, and `fee` are the relay's
// informational echo of the request and its gas estimate. They are listed so an
// otherwise valid quote is not rejected wholesale, while a genuinely unknown
// field still fails closed before anything is signed.
const QUOTE_KEYS = ["fee", "fee_action", "parameters", "type", "typed_data"];

// Names which part of a relay quote was unusable. The relay itself answered, so
// a bare "submission unavailable" would point the user at the wrong layer.
const quoteRejected = (reason: string): WalletError =>
  new WalletError(`${STRK20_SUBMISSION_UNAVAILABLE}: ${reason}`);

// The one piece of a JSON-RPC error worth showing is the reason, and the relay
// nests it: an execution rejection arrives as `data.execution_error`, not as a
// plain string. Reading only string `data` reduced every such rejection to a
// bare "TRANSACTION_EXECUTION_ERROR" with the actual cause thrown away.
const reportedDetails = (data: unknown): readonly string[] => {
  if (typeof data === "string") {
    return [data];
  }
  if (!isRecord(data)) {
    return [];
  }
  return Object.values(data).filter((value): value is string => typeof value === "string");
};

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
    body["id"] !== "mc-wallet-strk20"
  ) {
    throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  // A relay-reported error is an operator-side condition (credentials, an
  // unsupported fee mode, a rejected batch) that the generic message hides.
  // Surface the sanitized reason so it is diagnosable without a debug build;
  // endpoints, felts, and proof blobs never survive sanitizeStrk20Detail.
  const reported = body["error"];
  if (reported !== undefined) {
    const detail = sanitizeStrk20Detail(
      isRecord(reported)
        ? [reported["message"], ...reportedDetails(reported["data"])].join(": ")
        : String(reported),
    );
    throw new WalletError(
      detail === ""
        ? STRK20_SUBMISSION_UNAVAILABLE
        : `${STRK20_SUBMISSION_UNAVAILABLE}: the private relay rejected the request (${detail})`,
    );
  }
  if (!Object.hasOwn(body, "result")) {
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
  if (!isRecord(result) || !hasOnlyKnownKeys(result, QUOTE_KEYS)) {
    throw quoteRejected("the relay returned an unexpected quote shape");
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
    throw quoteRejected("the relay quoted its fee in an unexpected token");
  }
  if (!hasApprovals) {
    return { feeAction, mode: "private-relay" };
  }
  if (!boundTypedData) {
    throw quoteRejected("the relay returned no usable typed data for the public approvals");
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
  // The hash itself is still validated strictly, but extra informational fields
  // are tolerated here: by this point the transaction is already broadcast, and
  // discarding a valid hash over an unrecognized sibling key would lose the only
  // handle the wallet has on a live submission.
  if (
    !isRecord(result) ||
    typeof result["transaction_hash"] !== "string" ||
    !isNonZeroStarkFieldElement(result["transaction_hash"])
  ) {
    throw quoteRejected("the relay accepted the submission without a usable transaction hash");
  }
  return { transactionHash: result["transaction_hash"] };
};
