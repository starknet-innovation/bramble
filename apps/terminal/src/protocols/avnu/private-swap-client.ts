import type { PrivateCallAndProof } from "../../wallet/privacy/privacy-wallet";
import { validatedPrivateActions } from "../../wallet/privacy/privacy-wallet";
import { PRIVATE_SWAP_FEE_TOKEN } from "../../../shared/privacy";
import { sameAddress } from "../support/networks";
import type { Strk20Action } from "../support/strk20-schemas";

const FELT = /^0x[0-9a-fA-F]{1,64}$/;
const STARK_FIELD_PRIME =
  0x800000000000011000000000000000000000000000000000000000000000001n;
const TRANSACTION_HASH = /^0x0[0-8][0-9a-fA-F]{62}$/;

type PrivateFeeMode = {
  readonly poolFeeToken: string;
  readonly tip?: "fast" | "normal" | "slow";
};

export type PrivateSwapFee = {
  readonly amount: string;
  readonly recipient: string;
  readonly token: string;
};

export type PrivateSwapPlan = {
  readonly actions: readonly Strk20Action[];
  readonly buyAmount: string;
  readonly executor: string;
  readonly fee: PrivateSwapFee;
  readonly quoteId: string;
  readonly sellAmount: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key));

const isNonZeroFelt = (value: unknown): value is string =>
  typeof value === "string" &&
  FELT.test(value) &&
  BigInt(value) > 0n &&
  BigInt(value) < STARK_FIELD_PRIME;

const post = async (action: "fee" | "plan" | "submit", body: unknown): Promise<unknown> => {
  const response = await fetch(`/api/private-swap/${action}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error("Private swap service is unavailable.");
  }
  return response.json();
};

const actionsMatchPlan = (
  actions: readonly Strk20Action[],
  input: {
    readonly buyToken: string;
    readonly sellAmount: string;
    readonly sellToken: string;
    readonly takerAddress: string;
  },
  executor: string,
  fee: PrivateSwapFee,
): boolean => {
  const [sell, relay, receive, invoke] = actions;
  return (
    actions.length === 4 &&
    sell?.type === "withdraw" &&
    sell.amount === input.sellAmount &&
    sameAddress(sell.token, input.sellToken) &&
    sameAddress(sell.recipient, executor) &&
    relay?.type === "withdraw" &&
    relay.amount === fee.amount &&
    sameAddress(relay.token, fee.token) &&
    sameAddress(relay.recipient, fee.recipient) &&
    receive?.type === "transfer" &&
    receive.amount === "OPEN" &&
    sameAddress(receive.token, input.buyToken) &&
    sameAddress(receive.recipient, input.takerAddress) &&
    invoke?.type === "invoke" &&
    sameAddress(invoke.contract, executor) &&
    typeof invoke.calldata[0] === "string" &&
    sameAddress(invoke.calldata[0], input.buyToken) &&
    invoke.calldata[invoke.calldata.length - 1] === "${openNoteIds[0]}"
  );
};

/**
 * Builds an AVNU private route on the server, where the pinned SDK and
 * paymaster credential stay out of the browser bundle. Every returned action is
 * revalidated locally before display or wallet handoff.
 */
export const fetchPrivateSwapPlan = async (input: {
  readonly buyToken: string;
  readonly sellAmount: string;
  readonly sellToken: string;
  readonly takerAddress: string;
}): Promise<PrivateSwapPlan> => {
  const value = await post("plan", {
    ...input,
    feeMode: { poolFeeToken: PRIVATE_SWAP_FEE_TOKEN, tip: "normal" },
  });
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "actions",
      "buyAmount",
      "executor",
      "fee",
      "quoteId",
      "sellAmount",
    ]) ||
    !Array.isArray(value["actions"]) ||
    !isNonZeroFelt(value["buyAmount"]) ||
    !isNonZeroFelt(value["executor"]) ||
    !isRecord(value["fee"]) ||
    !hasOnlyKeys(value["fee"], ["amount", "recipient", "token"]) ||
    !isNonZeroFelt(value["fee"]["amount"]) ||
    !isNonZeroFelt(value["fee"]["recipient"]) ||
    !isNonZeroFelt(value["fee"]["token"]) ||
    !sameAddress(value["fee"]["token"], PRIVATE_SWAP_FEE_TOKEN) ||
    typeof value["quoteId"] !== "string" ||
    value["quoteId"].length === 0 ||
    value["quoteId"].length > 128 ||
    !isNonZeroFelt(value["sellAmount"]) ||
    value["sellAmount"] !== input.sellAmount
  ) {
    throw new Error("Private swap service returned an invalid route.");
  }
  const actions = validatedPrivateActions(value["actions"]);
  const fee = {
    amount: value["fee"]["amount"],
    recipient: value["fee"]["recipient"],
    token: value["fee"]["token"],
  };
  if (!actionsMatchPlan(actions, input, value["executor"], fee)) {
    throw new Error("Private swap service returned a substituted route.");
  }
  return {
    actions,
    buyAmount: value["buyAmount"],
    executor: value["executor"],
    fee,
    quoteId: value["quoteId"],
    sellAmount: value["sellAmount"],
  };
};

/**
 * Fetches the sponsored-private fee through the same-origin server boundary;
 * no paymaster credential enters the browser bundle.
 */
export const fetchPrivateSwapFee = async (
  feeMode: PrivateFeeMode,
): Promise<PrivateSwapFee> => {
  const value = await post("fee", { feeMode });
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["amount", "recipient", "token"]) ||
    !isNonZeroFelt(value["amount"]) ||
    !isNonZeroFelt(value["recipient"]) ||
    !isNonZeroFelt(value["token"]) ||
    !sameAddress(value["token"], feeMode.poolFeeToken)
  ) {
    throw new Error("Private swap service returned an invalid fee.");
  }
  return { amount: value["amount"], recipient: value["recipient"], token: value["token"] };
};

/**
 * Submits a wallet-produced proof through the server-side AVNU paymaster
 * boundary and validates the resulting transaction hash.
 */
export const submitPrivateSwapProof = async (
  callAndProof: PrivateCallAndProof,
  feeMode: PrivateFeeMode,
): Promise<string> => {
  const value = await post("submit", {
    callAndProof: {
      call: {
        calldata: callAndProof.call.calldata,
        contractAddress: callAndProof.call.contract_address,
        entrypoint: callAndProof.call.entry_point,
      },
      proof: {
        data: callAndProof.proof.data,
        proofFacts: callAndProof.proof.proof_facts,
      },
    },
    feeMode,
  });
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["transactionHash"]) ||
    typeof value["transactionHash"] !== "string" ||
    !TRANSACTION_HASH.test(value["transactionHash"])
  ) {
    throw new Error("Private swap service returned an invalid transaction hash.");
  }
  return value["transactionHash"];
};
