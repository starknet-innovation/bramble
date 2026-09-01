/**
 * Strict JSON-RPC client for the privacy paymaster's sponsored-private flow.
 * No API key is accepted: shared credentials cannot be protected in an
 * extension bundle, so authenticated deployments must expose a wallet-owned
 * relay instead.
 */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
} from "@bramble/starknet/provider";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { Strk20Proof } from "@bramble/wallet-protocol/strk20";
import type { Call } from "starknet";
import { CallData, hash } from "starknet";
import type { Strk20PaymasterConfig } from "../config";
import { sanitizeStrk20Detail } from "../sdk/official-sdk-errors";
import { STRK20_SUBMISSION_UNAVAILABLE, type Strk20PrivateRelayPlan } from "../service";

import { bindPaymasterTypedData, isPaymasterAuthorizationLive } from "./paymaster-typed-data";

type PaymasterCall = {
  readonly calldata: readonly string[];
  readonly selector: string;
  readonly to: string;
};

type PaymasterHttp = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const PARAMETERS = { version: "0x1" } as const;
const PAYMASTER_TIMEOUT_MS = 30_000;
const MAX_PAYMASTER_RESPONSE_BYTES = 1024 * 1024;
// The one relay method that puts a transaction on the wire, mirroring
// `BROADCAST_RPC_METHODS` in `../provider`: only a broadcast-capable call can
// leave a write in flight, so only it may mint the ambiguity marker.
const BROADCAST_PAYMASTER_METHOD = "paymaster_executeTransaction";

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

// Keys a `paymaster_buildTransaction` result may carry. Only `fee_action` and
// `typed_data` are consumed; `type`, `parameters`, and `fee` are the relay's
// informational echo of the request and its gas estimate. They are listed so an
// otherwise valid quote is not rejected wholesale, while a genuinely unknown
// field still fails closed before anything is signed.
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

const relayReportedError = (method: string, reported: unknown): WalletError => {
  // An execute error may echo the submitted proof. Proof values are allowed to
  // be short, so no pattern sanitizer can distinguish them reliably from a
  // useful reason. Keep that post-proof boundary generic; quote failures carry
  // no proof and may retain a bounded, sanitized diagnostic.
  if (method === BROADCAST_PAYMASTER_METHOD) {
    return new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
  }
  const detail = sanitizeStrk20Detail(
    isRecord(reported)
      ? [reported["message"], ...reportedDetails(reported["data"])].join(": ")
      : String(reported),
  );
  return new WalletError(
    detail === ""
      ? STRK20_SUBMISSION_UNAVAILABLE
      : `${STRK20_SUBMISSION_UNAVAILABLE}: the private relay rejected the request (${detail})`,
  );
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

// A relay answer the wallet could not read is not the same thing as a relay
// refusal. Once `paymaster_executeTransaction` has left the wallet, the relay
// may already have forwarded the transaction while its reply was truncated,
// oversized, unparseable, or ended by this client's own deadline — so that case
// carries the same ambiguity marker `runRpcBroadcast` mints on the JSON-RPC
// lane, and every layer above (the maturity scope in particular) holds its
// state closed instead of releasing it for a retry over a possibly-live write.
//
// Quote calls never broadcast, so their failures stay determinate; so does a
// refusal the relay states for itself, whether as a JSON-RPC error object or an
// HTTP status of its own choosing. This closes the lossy-channel case, not a
// relay that lies about having rejected a transaction it forwarded — no
// classification at this boundary can, and the relay URL is wallet-configured
// rather than dapp-supplied for exactly that reason.
const lostAnswer = (method: string): WalletError =>
  method === BROADCAST_PAYMASTER_METHOD
    ? new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE)
    : new WalletError(STRK20_SUBMISSION_UNAVAILABLE);

// An expired request deadline is the one send-side failure that is ambiguous:
// the request was written and this client stopped waiting for the answer. Every
// other rejection here (DNS, refused connection, a refused redirect) means no
// exchange took place. `AbortSignal.timeout` surfaces as this exact
// `DOMException`, and the transport is wallet-chosen, never remote-controlled.
const isDeadlineExpiry = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "TimeoutError";

const rpc = async (
  http: PaymasterHttp,
  url: string,
  method: string,
  params: unknown,
): Promise<unknown> => {
  let response: Response;
  try {
    response = await http(url, {
      body: JSON.stringify({ id: "bramble-strk20", jsonrpc: "2.0", method, params }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(PAYMASTER_TIMEOUT_MS),
    });
  } catch (error) {
    throw isDeadlineExpiry(error)
      ? lostAnswer(method)
      : new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
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
    throw lostAnswer(method);
  }
  if (
    !isRecord(body) ||
    !hasOnlyKnownKeys(body, ["error", "id", "jsonrpc", "result"]) ||
    body["jsonrpc"] !== "2.0" ||
    body["id"] !== "bramble-strk20"
  ) {
    throw lostAnswer(method);
  }
  const reported = body["error"];
  if (reported !== undefined) {
    throw relayReportedError(method, reported);
  }
  if (!Object.hasOwn(body, "result")) {
    throw lostAnswer(method);
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
  readonly expectedFeeAmount: bigint;
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
  // A relay fee withdrawn to the user's public account would link the private
  // action to that account on-chain. Compare numerically so padding cannot
  // bypass the boundary. For the wallet's STRK-only relay route, the quoted
  // amount must also equal the pool's independently-read on-chain fee: AVNU's
  // sponsored-private STRK path applies neither conversion nor overhead to it.
  // A mixed route also identifies the forwarder as the typed-data caller, so
  // bind the fee recipient to that independently reviewed field.
  if (
    !feeAction ||
    !sameFelt(feeAction.token, input.config.feeToken) ||
    sameFelt(feeAction.recipient, input.accountAddress) ||
    !sameFelt(feeAction.amount, input.expectedFeeAmount.toString()) ||
    (boundTypedData ? !sameFelt(feeAction.recipient, boundTypedData.review.caller) : false)
  ) {
    throw quoteRejected("the relay returned a fee outside the reviewed route");
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
 *
 * Failure behaviour, which callers must distinguish: everything refused before
 * the request goes out, every refusal the relay states for itself, and every
 * `paymaster_buildTransaction` failure throws a plain {@link WalletError} —
 * nothing is in flight and the caller may release its state. An answer to the
 * broadcast that the wallet could not read (oversized, unparseable,
 * uninterpretable, ended by this client's deadline, or a result with no usable
 * hash in it) throws an {@link IndeterminateRpcWriteError} instead: the relay
 * may already have forwarded the transaction, so the caller must hold its state
 * closed rather than retry.
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
  const result = await rpc(input.http ?? fetch, input.config.url, BROADCAST_PAYMASTER_METHOD, {
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
  //
  // A result with no usable hash in it is the worst case rather than a refusal:
  // the relay answered with a JSON-RPC *result*, so it accepted the submission
  // and the wallet simply has no handle on it. That is an ambiguous write, not a
  // rejected quote, so callers must hold their state closed rather than retry.
  if (
    !isRecord(result) ||
    typeof result["transaction_hash"] !== "string" ||
    !isNonZeroStarkFieldElement(result["transaction_hash"])
  ) {
    throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
  }
  return { transactionHash: result["transaction_hash"] };
};
