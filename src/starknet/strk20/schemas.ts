/**
 * Wire schemas for the STRK20 privacy method surface (wallet_strk20*): the
 * STRK20_ACTION discriminated union, the STRK20_PROOF / STRK20_CALL_AND_PROOF
 * envelope, and STRK20_BALANCE_ENTRY. Every value crossing the dapp boundary is
 * validated here so a single source of truth backs both the provider bridge and
 * the background handler. These guards are pure and never touch secret material.
 */
import { hasOnlyKnownKeys, isRecord } from "../../shared/json";
import { STARK_FIELD_PRIME } from "../networks";

// A felt fits in the Stark field. Amounts are STRK20 token quantities that may
// legitimately reach u256, so they are bounded by 2^256 rather than the field.
const U256_LIMIT = 1n << 256n;
const HEX_FELT_PATTERN = /^0x[0-9a-fA-F]+$/;
const INTEGER_PATTERN = /^(?:0x[0-9a-fA-F]+|0|[1-9][0-9]*)$/;
const ENTRY_POINT_PATTERN = /^(?:0x[0-9a-fA-F]{1,64}|[A-Za-z_][A-Za-z0-9_]*)$/;

const withinField = (value: string): boolean => {
  try {
    return BigInt(value) < STARK_FIELD_PRIME;
  } catch {
    return false;
  }
};

/**
 * Checks whether an untrusted value is a spec FELT: `0x` + hex, within the
 * Stark field.
 */
export const isStrk20Felt = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 66 &&
  HEX_FELT_PATTERN.test(value) &&
  withinField(value);

/**
 * Checks whether an untrusted value is a spec ADDRESS: a non-zero FELT.
 */
export const isStrk20Address = (value: unknown): value is string =>
  isStrk20Felt(value) && BigInt(value) > 0n;

/**
 * Checks whether an untrusted value is a positive STRK20 amount (decimal or
 * hex integer string, bounded by u256).
 */
export const isStrk20Amount = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 80 || !INTEGER_PATTERN.test(value)) {
    return false;
  }
  const amount = BigInt(value);
  return amount > 0n && amount < U256_LIMIT;
};

const isCalldataFelt = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 80 &&
  INTEGER_PATTERN.test(value) &&
  withinField(value);

const isEntryPoint = (value: unknown): value is string =>
  typeof value === "string" && ENTRY_POINT_PATTERN.test(value);

/**
 * A spec INVOKE_CALL: a contract address, an entry point, and felt calldata.
 */
export type Strk20InvokeCall = {
  readonly calldata: readonly string[];
  readonly contract_address: string;
  readonly entry_point: string;
};

/**
 * Parses an untrusted value into an INVOKE_CALL, copying the calldata so the
 * caller cannot mutate the source array. Returns null when any field is invalid.
 */
export const readStrk20InvokeCall = (value: unknown): Strk20InvokeCall | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["calldata", "contract_address", "entry_point"]) ||
    !isStrk20Address(value.contract_address) ||
    !isEntryPoint(value.entry_point) ||
    !Array.isArray(value.calldata) ||
    !value.calldata.every(isCalldataFelt)
  ) {
    return null;
  }
  return {
    calldata: [...value.calldata],
    contract_address: value.contract_address,
    entry_point: value.entry_point,
  };
};

/**
 * STRK20_DEPOSIT_ACTION: move a token amount from the public to the private
 * balance.
 */
export type Strk20DepositAction = {
  readonly action: "deposit";
  readonly amount: string;
  readonly token: string;
};

/**
 * STRK20_WITHDRAW_ACTION: move a token amount from the private to the public
 * balance.
 */
export type Strk20WithdrawAction = {
  readonly action: "withdraw";
  readonly amount: string;
  readonly token: string;
};

/**
 * STRK20_TRANSFER_ACTION: move a token amount from the private balance to a
 * recipient.
 */
export type Strk20TransferAction = {
  readonly action: "transfer";
  readonly amount: string;
  readonly recipient: string;
  readonly token: string;
};

/**
 * STRK20_INVOKE_ACTION: wrap an INVOKE_CALL executed privately.
 */
export type Strk20InvokeAction = {
  readonly action: "invoke";
  readonly call: Strk20InvokeCall;
};

/**
 * STRK20_ACTION: the discriminated union of the four privacy actions.
 */
export type Strk20Action =
  | Strk20DepositAction
  | Strk20InvokeAction
  | Strk20TransferAction
  | Strk20WithdrawAction;

const readValueMoveAction = (
  value: Record<string, unknown>,
  action: "deposit" | "withdraw",
): Strk20DepositAction | Strk20WithdrawAction | null =>
  hasOnlyKnownKeys(value, ["action", "amount", "token"]) &&
  isStrk20Address(value.token) &&
  isStrk20Amount(value.amount)
    ? { action, amount: value.amount, token: value.token }
    : null;

/**
 * Strictly parses one STRK20_ACTION by its `action` discriminant, rejecting any
 * variant carrying unexpected keys or malformed fields.
 */
export const readStrk20Action = (value: unknown): Strk20Action | null => {
  if (!isRecord(value) || typeof value.action !== "string") {
    return null;
  }
  if (value.action === "deposit" || value.action === "withdraw") {
    return readValueMoveAction(value, value.action);
  }
  if (value.action === "transfer") {
    return hasOnlyKnownKeys(value, ["action", "amount", "recipient", "token"]) &&
      isStrk20Address(value.token) &&
      isStrk20Address(value.recipient) &&
      isStrk20Amount(value.amount)
      ? {
          action: "transfer",
          amount: value.amount,
          recipient: value.recipient,
          token: value.token,
        }
      : null;
  }
  if (value.action === "invoke") {
    if (!hasOnlyKnownKeys(value, ["action", "call"])) {
      return null;
    }
    const call = readStrk20InvokeCall(value.call);
    return call ? { action: "invoke", call } : null;
  }
  return null;
};

/**
 * Parses a non-empty (minItems 1) STRK20_ACTION list, rejecting the whole list
 * if any member is malformed.
 */
export const readStrk20Actions = (value: unknown): readonly Strk20Action[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    return null;
  }
  const actions = value.map(readStrk20Action);
  return actions.every((action): action is Strk20Action => action !== null) ? actions : null;
};

/**
 * Parses a non-empty ADDRESS list used by the balances query.
 */
export const readStrk20Tokens = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    return null;
  }
  return value.every(isStrk20Address) ? [...value] : null;
};

/**
 * STRK20_PROOF: opaque proof data plus felt outputs and proof facts.
 */
export type Strk20Proof = {
  readonly data: string;
  readonly output: readonly string[];
  readonly proof_facts: readonly string[];
};

/**
 * Narrows an untrusted value to a spec STRK20_PROOF.
 */
export const isStrk20Proof = (value: unknown): value is Strk20Proof =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["data", "output", "proof_facts"]) &&
  typeof value.data === "string" &&
  value.data.length > 0 &&
  Array.isArray(value.output) &&
  value.output.every(isStrk20Felt) &&
  Array.isArray(value.proof_facts) &&
  value.proof_facts.every(isStrk20Felt);

/**
 * STRK20_CALL_AND_PROOF: the invoke call paired with its privacy proof.
 */
export type Strk20CallAndProof = {
  readonly call: Strk20InvokeCall;
  readonly proof: Strk20Proof;
};

/**
 * Narrows an untrusted value to a spec STRK20_CALL_AND_PROOF envelope.
 */
export const isStrk20CallAndProof = (value: unknown): value is Strk20CallAndProof =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["call", "proof"]) &&
  readStrk20InvokeCall(value.call) !== null &&
  isStrk20Proof(value.proof);

/**
 * STRK20_BALANCE_ENTRY: a token and its private balance felt.
 */
export type Strk20BalanceEntry = {
  readonly balance: string;
  readonly token: string;
};

/**
 * Narrows an untrusted value to a spec STRK20_BALANCE_ENTRY.
 */
export const isStrk20BalanceEntry = (value: unknown): value is Strk20BalanceEntry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["balance", "token"]) &&
  isStrk20Address(value.token) &&
  isStrk20Felt(value.balance);
