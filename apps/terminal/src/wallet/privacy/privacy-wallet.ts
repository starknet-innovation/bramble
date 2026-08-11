import type { WalletRequest } from "../connection/wallet-connection";
import { PRIVACY_POOL_ADDRESS } from "../../../shared/privacy";
import { sameAddress } from "../../protocols/support/networks";
import type { Strk20Action } from "../../protocols/support/strk20-schemas";

const FELT = /^0x[0-9a-fA-F]{1,64}$/;
const STARK_FIELD_PRIME =
  0x800000000000011000000000000000000000000000000000000000000000001n;
const TRANSACTION_HASH = /^0x0[0-8][0-9a-fA-F]{62}$/;
const MAX_ACTIONS = 32;
const MAX_CALLDATA = 4_096;
const MAX_PROOF_TEXT = 512 * 1024;
const MAX_PROOF_FELTS = 4_096;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key));

const isFelt = (value: unknown): value is string =>
  typeof value === "string" && FELT.test(value) && BigInt(value) < STARK_FIELD_PRIME;

const isAddress = (value: unknown): value is string => isFelt(value) && BigInt(value) > 0n;

const isAction = (value: unknown): value is Strk20Action => {
  if (!isRecord(value) || typeof value["type"] !== "string") {
    return false;
  }
  if (value["type"] === "deposit") {
    return (
      hasOnlyKeys(value, ["amount", "token", "type"]) &&
      isFelt(value["amount"]) &&
      isAddress(value["token"])
    );
  }
  if (value["type"] === "withdraw" || value["type"] === "transfer") {
    return (
      hasOnlyKeys(value, ["amount", "recipient", "token", "type"]) &&
      (value["type"] !== "transfer" || value["amount"] === "OPEN" || isFelt(value["amount"])) &&
      (value["type"] !== "withdraw" || isFelt(value["amount"])) &&
      isAddress(value["recipient"]) &&
      isAddress(value["token"])
    );
  }
  return (
    value["type"] === "invoke" &&
    hasOnlyKeys(value, ["calldata", "contract", "type"]) &&
    isAddress(value["contract"]) &&
    Array.isArray(value["calldata"]) &&
    value["calldata"].length <= MAX_CALLDATA &&
    value["calldata"].every(
      (item) =>
        isFelt(item) ||
        (typeof item === "string" &&
          /^\$\{(?:openNoteIds\[[0-9]+\]|poolAddress)\}$/.test(item)),
    )
  );
};

/**
 * Validates an untrusted private action batch before it can be shown or sent to
 * the wallet. Returns a copied, typed batch or throws without side effects.
 */
export const validatedPrivateActions = (
  actions: readonly unknown[],
): readonly Strk20Action[] => {
  if (
    actions.length === 0 ||
    actions.length > MAX_ACTIONS ||
    !actions.every(isAction)
  ) {
    throw new Error("The private action batch is invalid.");
  }
  return actions.map((action) =>
    action.type === "invoke"
      ? { ...action, calldata: [...action.calldata] }
      : { ...action },
  );
};

export type PrivateBalance = {
  readonly balance: string;
  readonly token: string;
};

export type PrivateCallAndProof = {
  readonly call: {
    readonly calldata: readonly string[];
    readonly contract_address: string;
    readonly entry_point: string;
  };
  readonly proof: {
    readonly data: string;
    readonly output: readonly string[];
    readonly proof_facts: readonly string[];
  };
};

/** Returns true only for the Wallet-API NOT_REGISTERED error. */
export const isPrivateRegistrationRequired = (cause: unknown): boolean =>
  (cause as { readonly code?: unknown } | null | undefined)?.code === 118;

const readBalances = (value: unknown): readonly PrivateBalance[] | null => {
  if (!Array.isArray(value) || value.length > 64) {
    return null;
  }
  const balances: PrivateBalance[] = [];
  const tokens = new Set<bigint>();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["balance", "token"]) ||
      !isFelt(entry["balance"]) ||
      !isAddress(entry["token"])
    ) {
      return null;
    }
    const token = BigInt(entry["token"]);
    if (tokens.has(token)) {
      return null;
    }
    tokens.add(token);
    balances.push({ balance: entry["balance"], token: entry["token"] });
  }
  return balances;
};

const readCallAndProof = (value: unknown): PrivateCallAndProof | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["call", "proof"]) ||
    !isRecord(value["call"]) ||
    !hasOnlyKeys(value["call"], ["calldata", "contract_address", "entry_point"]) ||
    !isAddress(value["call"]["contract_address"]) ||
    !sameAddress(value["call"]["contract_address"], PRIVACY_POOL_ADDRESS) ||
    value["call"]["entry_point"] !== "apply_actions" ||
    !Array.isArray(value["call"]["calldata"]) ||
    value["call"]["calldata"].length > MAX_CALLDATA ||
    !value["call"]["calldata"].every(isFelt) ||
    !isRecord(value["proof"]) ||
    !hasOnlyKeys(value["proof"], ["data", "output", "proof_facts"]) ||
    typeof value["proof"]["data"] !== "string" ||
    value["proof"]["data"].length === 0 ||
    value["proof"]["data"].length > MAX_PROOF_TEXT ||
    !Array.isArray(value["proof"]["output"]) ||
    value["proof"]["output"].length === 0 ||
    value["proof"]["output"].length > MAX_PROOF_FELTS ||
    !value["proof"]["output"].every(isFelt) ||
    !Array.isArray(value["proof"]["proof_facts"]) ||
    value["proof"]["proof_facts"].length === 0 ||
    value["proof"]["proof_facts"].length > MAX_PROOF_FELTS ||
    !value["proof"]["proof_facts"].every(isFelt)
  ) {
    return null;
  }
  return {
    call: {
      calldata: [...value["call"]["calldata"]],
      contract_address: value["call"]["contract_address"],
      entry_point: "apply_actions",
    },
    proof: {
      data: value["proof"]["data"],
      output: [...value["proof"]["output"]],
      proof_facts: [...value["proof"]["proof_facts"]],
    },
  };
};

const requestFrom = (wallet: { readonly request?: unknown } | null): WalletRequest => {
  if (!wallet || typeof wallet.request !== "function") {
    throw new Error("Connect MC Wallet to use private balances.");
  }
  return wallet.request as WalletRequest;
};

/**
 * Reads private balances through the standard wallet API. The wallet owns note
 * discovery and viewing keys; the Terminal receives only aggregate balances.
 */
export const requestPrivateBalances = async (
  wallet: { readonly request?: unknown } | null,
  tokens: readonly string[],
): Promise<readonly PrivateBalance[]> => {
  const tokenSet = new Set(tokens.map((token) => (isAddress(token) ? BigInt(token) : -1n)));
  if (tokens.length > 64 || !tokens.every(isAddress) || tokenSet.size !== tokens.length) {
    throw new Error("The private balance token list is invalid.");
  }
  const result = await requestFrom(wallet)({
    params: { tokens: [...tokens] },
    type: "wallet_strk20Balances",
  });
  const balances = readBalances(result);
  if (!balances) {
    throw new Error("Wallet returned invalid private balances.");
  }
  return balances;
};

/**
 * Requests MC Wallet's approval-gated one-time pool registration. This is an
 * MC-namespaced capability because the standard STRK20 API defines the
 * NOT_REGISTERED error but no registration method.
 */
export const requestPrivateRegistration = async (
  wallet: { readonly request?: unknown } | null,
): Promise<string> => {
  const result = await requestFrom(wallet)({ type: "mc_strk20Register" });
  if (
    !isRecord(result) ||
    !hasOnlyKeys(result, ["transaction_hash"]) ||
    typeof result["transaction_hash"] !== "string" ||
    !TRANSACTION_HASH.test(result["transaction_hash"])
  ) {
    throw new Error("Wallet returned an invalid registration transaction hash.");
  }
  return result["transaction_hash"];
};

/**
 * Requests proof creation for an already-reviewed private action batch. No
 * viewing key, note, or signing material crosses into the Terminal.
 */
export const requestPrivateProof = async (
  wallet: { readonly request?: unknown } | null,
  actions: readonly unknown[],
): Promise<PrivateCallAndProof> => {
  const result = await requestFrom(wallet)({
    params: { actions: validatedPrivateActions(actions), simulate: false },
    type: "wallet_strk20PrepareInvoke",
  });
  const callAndProof = readCallAndProof(result);
  if (!callAndProof) {
    throw new Error("Wallet returned an invalid private proof.");
  }
  return callAndProof;
};

/**
 * Proves and submits a private action batch through the wallet's normal
 * approval path, returning only a validated Starknet transaction hash.
 */
export const requestPrivateInvoke = async (
  wallet: { readonly request?: unknown } | null,
  actions: readonly unknown[],
): Promise<string> => {
  const result = await requestFrom(wallet)({
    params: { actions: validatedPrivateActions(actions) },
    type: "wallet_strk20InvokeTransaction",
  });
  if (
    !isRecord(result) ||
    !hasOnlyKeys(result, ["transaction_hash"]) ||
    typeof result["transaction_hash"] !== "string" ||
    !TRANSACTION_HASH.test(result["transaction_hash"])
  ) {
    throw new Error("Wallet returned an invalid private transaction hash.");
  }
  return result["transaction_hash"];
};
