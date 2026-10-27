/**
 * Gasless request and response shapes. Build requests are the ones
 * `inspect_gasless` accepts: version `0x1`, fee mode `default` only, no tip
 * unless a caller adds one (this client does not), no `time_bounds`, and
 * calls whose felts are already `0x`. Execute posts AVNU's typed data
 * unchanged. Sponsored modes are not representable here.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { type FeeAffordability, resolveFeeAffordability } from "@bramble/transactions/fee-funds";
import {
  isApproveEntrypoint,
  PLAIN_TRANSFER_FROM_ENTRYPOINTS,
} from "@bramble/transactions/verify-selectors";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  STRK_TOKEN_ADDRESS,
  sameFelt,
  uint256Felts,
} from "@bramble/wallet-model/networks";
import { type Call, CallData, hash } from "starknet";
import { GaslessRefusal } from "./gasless-errors";

/**
 * How many tokens a review may offer. Bounds the build calls one review makes.
 */
export const MAX_GASLESS_OFFERS = 3;

/**
 * A fee token the user can choose. `amount` is the maximum base units, as
 * decimal digits, so a later echo compares without hex padding.
 */
export type GaslessFeeOffer = {
  readonly amount: string;
  readonly decimals: number;
  readonly label: string;
  readonly tokenAddress: string;
};

const LABEL_PATTERN = /^[A-Za-z0-9.]{1,32}$/;
const AMOUNT_PATTERN = /^[1-9][0-9]{0,77}$/;
const FEE_KEYS = [
  "estimated_fee_in_gas_token",
  "estimated_fee_in_strk",
  "gas_token_price_in_strk",
  "suggested_max_fee_in_gas_token",
  "suggested_max_fee_in_strk",
] as const;
const TOKEN_KEYS = ["decimals", "price_in_strk", "token_address"] as const;

const felt = (value: string, allowZero: boolean): string => {
  const canonical = canonicalFelt(value);
  if (
    canonical === null ||
    (allowZero ? !isStarkFieldElement(canonical) : !isNonZeroStarkFieldElement(canonical))
  ) {
    throw new GaslessRefusal("unavailable");
  }
  return canonical;
};

/**
 * Whether `value` is a fee offer this wallet could have rendered. Rejects a
 * paymaster-supplied label: the symbol grammar is the wallet's own.
 */
export const isGaslessFeeOffer = (value: unknown): value is GaslessFeeOffer => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["amount", "decimals", "label", "tokenAddress"])
  ) {
    return false;
  }
  const decimals = value["decimals"];
  return (
    typeof value["amount"] === "string" &&
    AMOUNT_PATTERN.test(value["amount"]) &&
    typeof decimals === "number" &&
    Number.isInteger(decimals) &&
    decimals >= 0 &&
    decimals <= 36 &&
    typeof value["label"] === "string" &&
    LABEL_PATTERN.test(value["label"]) &&
    typeof value["tokenAddress"] === "string" &&
    isNonZeroStarkFieldElement(value["tokenAddress"]) &&
    canonicalFelt(value["tokenAddress"]) === value["tokenAddress"] &&
    !sameFelt(value["tokenAddress"], STRK_TOKEN_ADDRESS)
  );
};

/**
 * One supported token from `paymaster_getSupportedTokens`. The paymaster's
 * price is ignored; a malformed list fails closed as null.
 */
export type GaslessListedToken = {
  readonly address: string;
  readonly decimals: number;
};

/**
 * Parses `paymaster_getSupportedTokens`. Null when the result is not a list
 * of address/decimals rows. `price_in_strk` may be present and is not read.
 */
export const readGaslessSupportedTokens = (
  value: unknown,
): readonly GaslessListedToken[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const tokens: GaslessListedToken[] = [];
  for (const item of value) {
    if (!isRecord(item) || !hasOnlyKnownKeys(item, TOKEN_KEYS)) {
      return null;
    }
    const address = item["token_address"];
    const decimals = item["decimals"];
    const canonical = typeof address === "string" ? canonicalFelt(address) : null;
    if (
      canonical === null ||
      !isNonZeroStarkFieldElement(canonical) ||
      typeof decimals !== "number" ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 36 ||
      (item["price_in_strk"] !== undefined &&
        (typeof item["price_in_strk"] !== "string" || !isStarkFieldElement(item["price_in_strk"])))
    ) {
      return null;
    }
    tokens.push({ address: canonical, decimals });
  }
  return tokens;
};

/**
 * Whether `paymaster_isAvailable` said the route can build. Only `true`
 * counts; every other result hides gasless.
 */
export const readGaslessAvailable = (value: unknown): boolean => value === true;

const encodeCall = (
  call: Call,
): { readonly calldata: readonly string[]; readonly selector: string; readonly to: string } => {
  const selector = isStarkFieldElement(call.entrypoint)
    ? felt(call.entrypoint, false)
    : felt(hash.getSelectorFromName(call.entrypoint), false);
  return {
    calldata: CallData.compile(call.calldata ?? []).map((item) => felt(String(item), true)),
    selector,
    to: felt(call.contractAddress, false),
  };
};

/**
 * Deployment object the gateway accepts. `version` is a JSON number from 0
 * to 255, not a felt. Returns null when the deployment address is not the
 * invoking account.
 */
export const gaslessDeploymentBody = (
  deployment: {
    readonly addressSalt: string;
    readonly classHash: string;
    readonly constructorCalldata: readonly string[];
    readonly contractAddress: string;
  },
  userAddress: string,
): {
  readonly address: string;
  readonly calldata: readonly string[];
  readonly class_hash: string;
  readonly salt: string;
  readonly version: 1;
} | null => {
  const address = felt(deployment.contractAddress, false);
  if (!sameFelt(address, felt(userAddress, false))) {
    return null;
  }
  return {
    address,
    calldata: deployment.constructorCalldata.map((item) => felt(item, true)),
    class_hash: felt(deployment.classHash, false),
    salt: felt(deployment.addressSalt, true),
    version: 1,
  };
};

/**
 * `paymaster_buildTransaction` params for fee mode `default`. Throws when a
 * call cannot be encoded as `0x` felts. Omits tip and time bounds.
 */
export const gaslessBuildParams = (input: {
  readonly calls: readonly Call[];
  readonly deployment?: ReturnType<typeof gaslessDeploymentBody>;
  readonly gasToken: string;
  readonly userAddress: string;
}): {
  readonly parameters: {
    readonly fee_mode: { readonly gas_token: string; readonly mode: "default" };
    readonly version: "0x1";
  };
  readonly transaction: Record<string, unknown>;
  readonly userAddress: string;
} => {
  if (input.calls.length === 0) {
    throw new GaslessRefusal("unavailable");
  }
  const userAddress = felt(input.userAddress, false);
  const invoke = {
    calls: input.calls.map(encodeCall),
    user_address: userAddress,
  };
  const transaction =
    input.deployment === undefined || input.deployment === null
      ? { invoke, type: "invoke" }
      : { deployment: input.deployment, invoke, type: "deploy_and_invoke" };
  return {
    parameters: {
      fee_mode: { gas_token: felt(input.gasToken, false), mode: "default" },
      version: "0x1",
    },
    transaction,
    userAddress,
  };
};

/**
 * The quoted token maximum from a build result, plus the typed data to
 * validate. Null when the shape is not the invoke or deploy-and-invoke
 * result this client asked for. The echoed `parameters` are not returned;
 * execute sends a fresh `default` fee mode.
 */
export const readGaslessQuote = (
  value: unknown,
  kind: "deploy_and_invoke" | "invoke",
): { readonly quotedMax: bigint; readonly typedData: unknown } | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["deployment", "fee", "parameters", "type", "typed_data"])
  ) {
    return null;
  }
  if (
    value["type"] !== kind ||
    !isRecord(value["parameters"]) ||
    !Object.hasOwn(value, "typed_data")
  ) {
    return null;
  }
  if (kind === "invoke" && value["deployment"] !== undefined) {
    return null;
  }
  const fee = value["fee"];
  if (!isRecord(fee) || !hasOnlyKnownKeys(fee, FEE_KEYS)) {
    return null;
  }
  if (!FEE_KEYS.every((key) => typeof fee[key] === "string" && isStarkFieldElement(fee[key]))) {
    return null;
  }
  return {
    quotedMax: BigInt(fee["suggested_max_fee_in_gas_token"] as string),
    typedData: value["typed_data"],
  };
};

/**
 * Transaction hash from `paymaster_executeTransaction`. Null when the result
 * has no usable hash — the caller treats that as a lost reply, because the
 * relay may already have accepted the execution.
 */
export const readGaslessTransactionHash = (value: unknown): string | null => {
  const hashField = isRecord(value) ? value["transaction_hash"] : value;
  return typeof hashField === "string" && isNonZeroStarkFieldElement(hashField) ? hashField : null;
};

const spendsBalance = (entrypoint: string): boolean =>
  entrypoint === "transfer" || PLAIN_TRANSFER_FROM_ENTRYPOINTS.includes(entrypoint);

const transferAmount = (call: Call): bigint | null => {
  let compiled: readonly string[];
  try {
    compiled = CallData.compile(call.calldata ?? []).map((item) => String(item));
  } catch {
    return null;
  }
  const offset = call.entrypoint === "transfer" ? 1 : 2;
  return uint256Felts(compiled[offset], compiled[offset + 1]);
};

/**
 * How many base units of `token` the user's calls spend, or null when a call
 * to that token is not a known transfer or approval. Null fails the offer
 * closed instead of under-counting a spend.
 */
export const gaslessTokenSpend = (calls: readonly Call[], token: string): bigint | null => {
  let spent = 0n;
  for (const call of calls) {
    if (!sameFelt(call.contractAddress, token)) {
      continue;
    }
    if (isApproveEntrypoint(call.entrypoint)) {
      continue;
    }
    if (!spendsBalance(call.entrypoint)) {
      return null;
    }
    const amount = transferAmount(call);
    if (amount === null) {
      return null;
    }
    spent += amount;
  }
  return spent;
};

/**
 * Whether STRK covers the fee plus the STRK the calls themselves spend.
 *
 * The card's warn-only verdict compares the fee alone. A transfer of the whole
 * balance would then look payable, and no other fee token would be offered.
 * An unrecognised call to STRK is "unknown" so the offer stays hidden.
 */
export const gaslessStrkAffordability = (
  calls: readonly Call[],
  balance: string | null,
  fee: FeeEstimate | null,
): FeeAffordability => {
  const spent = gaslessTokenSpend(calls, STRK_TOKEN_ADDRESS);
  if (spent === null) {
    return "unknown";
  }
  return resolveFeeAffordability({ balance, fee, sendAmount: spent });
};
