import {
  buildPrivateSwapFee,
  buildStrk20Actions,
  getQuotes,
  quoteToCalls,
  submitPrivateSwap,
  type PrivateFeeMode,
  type PrivateSwapCallAndProof,
} from "@avnu/avnu-sdk";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Call } from "starknet";
import {
  authorizeOrigin,
  AVNU_PAYMASTER_URL,
  hasOnlyKeys,
  isFelt,
  isNonZeroFelt,
  isRecord,
  MAX_CALLDATA_FELTS,
  MAX_PROOF_CHARACTERS,
  MAX_PROOF_FACTS,
  PRIVATE_SWAP_FEE_TOKEN,
  PRIVACY_POOL_ADDRESS,
  readJsonBody,
  reject,
  serviceUrl,
} from "../_lib/security.js";

export const config = { maxDuration: 120 };
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const TIPS = new Set(["fast", "normal", "slow"]);
const MAINNET_CHAIN_ID = 0x534e5f4d41494en;

const feeModeFrom = (value: unknown): PrivateFeeMode | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["poolFeeToken", "tip"]) ||
    !isNonZeroFelt(value["poolFeeToken"]) ||
    BigInt(value["poolFeeToken"]) !== BigInt(PRIVATE_SWAP_FEE_TOKEN) ||
    (value["tip"] !== undefined || Object.hasOwn(value, "tip")) &&
      (typeof value["tip"] !== "string" || !TIPS.has(value["tip"]))
  ) {
    return null;
  }
  return {
    poolFeeToken: value["poolFeeToken"],
    ...(typeof value["tip"] === "string" ? { tip: value["tip"] as PrivateFeeMode["tip"] } : {}),
  };
};

const callAndProofFrom = (value: unknown): PrivateSwapCallAndProof | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["call", "proof"]) ||
    !isRecord(value["call"]) ||
    !hasOnlyKeys(value["call"], ["calldata", "contractAddress", "entrypoint"]) ||
    !isNonZeroFelt(value["call"]["contractAddress"]) ||
    BigInt(value["call"]["contractAddress"]) !== BigInt(PRIVACY_POOL_ADDRESS) ||
    value["call"]["entrypoint"] !== "apply_actions" ||
    !Array.isArray(value["call"]["calldata"]) ||
    value["call"]["calldata"].length > MAX_CALLDATA_FELTS ||
    !value["call"]["calldata"].every(isFelt) ||
    !isRecord(value["proof"]) ||
    !hasOnlyKeys(value["proof"], ["data", "proofFacts"]) ||
    typeof value["proof"]["data"] !== "string" ||
    value["proof"]["data"].length === 0 ||
    value["proof"]["data"].length > MAX_PROOF_CHARACTERS ||
    !Array.isArray(value["proof"]["proofFacts"]) ||
    value["proof"]["proofFacts"].length === 0 ||
    value["proof"]["proofFacts"].length > MAX_PROOF_FACTS ||
    !value["proof"]["proofFacts"].every(isFelt)
  ) {
    return null;
  }
  return {
    call: {
      calldata: [...value["call"]["calldata"]],
      contractAddress: value["call"]["contractAddress"],
      entrypoint: "apply_actions",
    },
    proof: {
      data: value["proof"]["data"],
      proofFacts: [...value["proof"]["proofFacts"]],
    },
  };
};

const options = (): {
  readonly abortSignal: AbortSignal;
  readonly paymasterBaseUrl: string;
} | null => {
  const paymasterBaseUrl = serviceUrl("STRK20_PAYMASTER_UPSTREAM", AVNU_PAYMASTER_URL);
  return paymasterBaseUrl
    ? { abortSignal: AbortSignal.timeout(110_000), paymasterBaseUrl }
    : null;
};

const sameFelt = (left: string, right: string): boolean => {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
};

const isMainnetChain = (value: string): boolean => {
  if (value === "SN_MAIN") {
    return true;
  }
  try {
    return BigInt(value) === MAINNET_CHAIN_ID;
  } catch {
    return false;
  }
};

const readPlanInput = (
  body: Record<string, unknown>,
): {
  readonly buyToken: string;
  readonly sellAmount: bigint;
  readonly sellToken: string;
  readonly takerAddress: string;
} | null => {
  if (
    !hasOnlyKeys(body, ["buyToken", "feeMode", "sellAmount", "sellToken", "takerAddress"]) ||
    !isNonZeroFelt(body["buyToken"]) ||
    !isNonZeroFelt(body["sellToken"]) ||
    sameFelt(body["buyToken"], body["sellToken"]) ||
    !isNonZeroFelt(body["sellAmount"]) ||
    !isNonZeroFelt(body["takerAddress"])
  ) {
    return null;
  }
  return {
    buyToken: body["buyToken"],
    sellAmount: BigInt(body["sellAmount"]),
    sellToken: body["sellToken"],
    takerAddress: body["takerAddress"],
  };
};

const executorCallsFrom = (value: unknown): Call[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    return null;
  }
  const calls: Call[] = [];
  let calldataLength = 0;
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["calldata", "contractAddress", "entrypoint"]) ||
      !isNonZeroFelt(entry["contractAddress"]) ||
      typeof entry["entrypoint"] !== "string" ||
      entry["entrypoint"].length > 64 ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry["entrypoint"]) ||
      !Array.isArray(entry["calldata"]) ||
      !entry["calldata"].every(isFelt)
    ) {
      return null;
    }
    calldataLength += entry["calldata"].length;
    if (calldataLength > MAX_CALLDATA_FELTS) {
      return null;
    }
    calls.push({
      calldata: [...entry["calldata"]],
      contractAddress: entry["contractAddress"],
      entrypoint: entry["entrypoint"],
    });
  }
  return calls;
};

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<VercelResponse | void> {
  if (!authorizeOrigin(request, response, "terminal")) {
    return;
  }
  if (request.method !== "POST") {
    return reject(response, 405, "method_not_allowed");
  }
  const action = typeof request.query.action === "string" ? request.query.action : null;
  if (action !== "fee" && action !== "plan" && action !== "submit") {
    return reject(response, 404, "route_not_allowed");
  }
  const body = readJsonBody<Record<string, unknown>>(request, MAX_BODY_BYTES);
  const feeMode = body ? feeModeFrom(body["feeMode"]) : null;
  const avnuOptions = options();
  if (!body || !feeMode || !avnuOptions) {
    return reject(response, 400, "invalid_private_swap_request");
  }
  const paymasterApiKey = process.env.AVNU_PAYMASTER_API_KEY;
  try {
    if (action === "fee") {
      if (!hasOnlyKeys(body, ["feeMode"])) {
        return reject(response, 400, "invalid_private_swap_request");
      }
      const fee = await buildPrivateSwapFee(
        {
          feeMode,
          poolAddress: PRIVACY_POOL_ADDRESS,
          ...(paymasterApiKey ? { paymasterApiKey } : {}),
        },
        avnuOptions,
      );
      if (
        !isNonZeroFelt(fee.token) ||
        BigInt(fee.token) !== BigInt(feeMode.poolFeeToken) ||
        !isNonZeroFelt(fee.recipient) ||
        !isNonZeroFelt(`0x${fee.amount.toString(16)}`)
      ) {
        return reject(response, 502, "invalid_paymaster_response");
      }
      return response.status(200).json({
        amount: `0x${fee.amount.toString(16)}`,
        recipient: fee.recipient,
        token: fee.token,
      });
    }
    if (action === "plan") {
      const input = readPlanInput(body);
      if (!input) {
        return reject(response, 400, "invalid_private_swap_request");
      }
      const [quotes, fee] = await Promise.all([
        getQuotes(
          {
            buyTokenAddress: input.buyToken,
            sellAmount: input.sellAmount,
            sellTokenAddress: input.sellToken,
            size: 1,
          },
          { abortSignal: AbortSignal.timeout(25_000) },
        ),
        buildPrivateSwapFee(
          {
            feeMode,
            poolAddress: PRIVACY_POOL_ADDRESS,
            ...(paymasterApiKey ? { paymasterApiKey } : {}),
          },
          avnuOptions,
        ),
      ]);
      const quote = quotes[0];
      if (
        !quote ||
        quote.sellAmount !== input.sellAmount ||
        !sameFelt(quote.sellTokenAddress, input.sellToken) ||
        !sameFelt(quote.buyTokenAddress, input.buyToken) ||
        !isMainnetChain(quote.chainId) ||
        !isNonZeroFelt(`0x${quote.buyAmount.toString(16)}`) ||
        !isNonZeroFelt(fee.token) ||
        !sameFelt(fee.token, feeMode.poolFeeToken) ||
        !isNonZeroFelt(fee.recipient) ||
        !isNonZeroFelt(`0x${fee.amount.toString(16)}`)
      ) {
        return reject(response, 502, "invalid_private_swap_plan");
      }
      const built = await quoteToCalls(
        { private: true, quoteId: quote.quoteId, slippage: 0.005 },
        { abortSignal: AbortSignal.timeout(25_000) },
      );
      const executorCalls = executorCallsFrom(built.calls);
      if (
        typeof quote.quoteId !== "string" ||
        !/^[\x21-\x7e]{1,128}$/.test(quote.quoteId) ||
        !built.executorAddress ||
        !isNonZeroFelt(built.executorAddress) ||
        !executorCalls ||
        !isMainnetChain(built.chainId)
      ) {
        return reject(response, 502, "invalid_private_swap_plan");
      }
      const actions = buildStrk20Actions({
        buyTokenAddress: input.buyToken,
        executorAddress: built.executorAddress,
        executorCalls,
        fee,
        sellAmount: input.sellAmount,
        sellTokenAddress: input.sellToken,
        takerAddress: input.takerAddress,
      });
      return response.status(200).json({
        actions,
        buyAmount: `0x${quote.buyAmount.toString(16)}`,
        executor: built.executorAddress,
        fee: {
          amount: `0x${fee.amount.toString(16)}`,
          recipient: fee.recipient,
          token: fee.token,
        },
        quoteId: quote.quoteId,
        sellAmount: `0x${input.sellAmount.toString(16)}`,
      });
    }
    if (!hasOnlyKeys(body, ["callAndProof", "feeMode"])) {
      return reject(response, 400, "invalid_private_swap_request");
    }
    const callAndProof = callAndProofFrom(body["callAndProof"]);
    if (!callAndProof) {
      return reject(response, 400, "invalid_private_swap_proof");
    }
    const result = await submitPrivateSwap(
      {
        callAndProof,
        feeMode,
        ...(paymasterApiKey ? { paymasterApiKey } : {}),
      },
      avnuOptions,
    );
    if (!isNonZeroFelt(result.transactionHash)) {
      return reject(response, 502, "invalid_paymaster_response");
    }
    return response.status(200).json({ transactionHash: result.transactionHash });
  } catch {
    return reject(response, 502, "private_swap_service_unavailable");
  }
}
