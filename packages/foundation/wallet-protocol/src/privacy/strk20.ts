/**
 * Wire schemas for the STRK20 privacy method surface (wallet_strk20*): the
 * STRK20_ACTION discriminated union, the STRK20_PROOF / STRK20_CALL_AND_PROOF
 * envelope, and STRK20_BALANCE_ENTRY. Every value crossing the dapp boundary is
 * validated here so a single source of truth backs both the provider bridge and
 * the background handler. These guards are pure and never touch secret material.
 *
 * The action shapes track the canonical Wallet-API 0.10.4-rc.0 STRK20 definitions
 * (starkware-libs/starknet-specs wallet-api/wallet_rpc.json): actions are
 * discriminated by a `type` field; withdraw carries a required `recipient`;
 * transfer accepts either a FELT amount or the literal string "OPEN" (an open
 * note); invoke is the flat `{ type, contract, calldata }` shape (no
 * entry_point) whose calldata items are FELTs or wallet-resolved placeholder
 * strings. The INVOKE_CALL used by the STRK20_CALL_AND_PROOF result is a
 * separate, prover-produced shape and keeps its `entry_point` field.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { STARK_FIELD_PRIME } from "@bramble/wallet-model/networks";

const HEX_FELT_PATTERN = /^0x[0-9a-fA-F]+$/;
// A calldata placeholder the wallet resolves during action assembly:
// `${openNoteIds[N]}` (zero-based) or `${poolAddress}`.
const CALLDATA_PLACEHOLDER_PATTERN = /^\$\{(?:openNoteIds\[[0-9]+\]|poolAddress)\}$/;
const ENTRY_POINT_PATTERN = /^(?:0x[0-9a-fA-F]{1,64}|[A-Za-z_][A-Za-z0-9_]*)$/;
// The literal transfer amount that requests a new open note instead of a fixed
// transfer.
const OPEN_AMOUNT = "OPEN";

/**
 * Cross-layer STRK20 container limits shared by dapp params, prover responses,
 * and provider result validation.
 */
export const STRK20_LIMITS = {
  actionCalldataItems: 4_096,
  actions: 32,
  balances: 64,
  discoveredNotes: 4_096,
  invokeCalldataFelts: 4_096,
  proofDataCharacters: 512 * 1024,
  proofFacts: 4_096,
  proofOutputFelts: 4_096,
  sdkWarnings: 64,
  subaccountCalls: 16,
  tokens: 64,
} as const;

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
const isStrk20Address = (value: unknown): value is string =>
  isStrk20Felt(value) && BigInt(value) > 0n;

/**
 * Checks whether an untrusted value is a spec STRK20 amount: a FELT quantity in
 * the token's smallest unit. Deposit and withdraw amounts use this directly;
 * transfer additionally accepts the literal "OPEN".
 */
const isStrk20Amount = (value: unknown): value is string => isStrk20Felt(value);

// Checks whether an untrusted value is a transfer amount: a FELT or the literal
// "OPEN" open-note request.
const isStrk20TransferAmount = (value: unknown): value is string =>
  value === OPEN_AMOUNT || isStrk20Felt(value);

// Checks whether an untrusted value is a STRK20_CALLDATA_ITEM: a FELT or one of
// the wallet-resolved placeholder strings.
const isStrk20CalldataItem = (value: unknown): value is string =>
  isStrk20Felt(value) || (typeof value === "string" && CALLDATA_PLACEHOLDER_PATTERN.test(value));

const isEntryPoint = (value: unknown): value is string =>
  typeof value === "string" && ENTRY_POINT_PATTERN.test(value);

/**
 * A spec INVOKE_CALL: a contract address, an entry point, and felt calldata.
 * This is the prover-produced call carried inside a STRK20_CALL_AND_PROOF
 * result, distinct from the flat STRK20_INVOKE_ACTION on the request side.
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
    !isStrk20Address(value["contract_address"]) ||
    !isEntryPoint(value["entry_point"]) ||
    !Array.isArray(value["calldata"]) ||
    value["calldata"].length > STRK20_LIMITS.invokeCalldataFelts ||
    !value["calldata"].every(isStrk20Felt)
  ) {
    return null;
  }
  return {
    calldata: [...value["calldata"]],
    contract_address: value["contract_address"],
    entry_point: value["entry_point"],
  };
};

/**
 * STRK20_DEPOSIT_ACTION: move a token amount from the public to the private
 * balance. `recipient` names whose private balance is credited; omitted, the
 * depositor is credited by the batch's implicit surplus.
 *
 * A deposit is public either way — the pool publishes the payer and the amount —
 * so naming a recipient conceals only who receives the value, never the sender
 * or the amount.
 */
export type Strk20DepositAction = {
  readonly amount: string;
  readonly recipient?: string;
  readonly token: string;
  readonly type: "deposit";
};

/**
 * STRK20_WITHDRAW_ACTION: move a token amount from the private balance to a
 * public recipient address.
 */
export type Strk20WithdrawAction = {
  readonly amount: string;
  readonly recipient: string;
  readonly token: string;
  readonly type: "withdraw";
};

/**
 * STRK20_TRANSFER_ACTION: privately transfer a token amount to a registered
 * recipient inside the pool. `amount` may be the literal "OPEN" to create an
 * open note instead of transferring a fixed amount.
 */
export type Strk20TransferAction = {
  readonly amount: string;
  readonly recipient: string;
  readonly token: string;
  readonly type: "transfer";
};

/**
 * STRK20_INVOKE_ACTION: invoke an arbitrary contract as part of the same STRK20
 * transaction. Calldata items are FELTs or wallet-resolved placeholder strings.
 */
export type Strk20InvokeAction = {
  readonly calldata: readonly string[];
  readonly contract: string;
  readonly type: "invoke";
};

/**
 * How a sub-account invocation collects each open note created in the same
 * transaction.
 */
export type Strk20CollectPolicy =
  | { readonly type: "all" }
  | { readonly type: "diff" }
  | { readonly amount: string; readonly type: "exact" };

/**
 * STRK20_SUBACCOUNT_INVOKE_ACTION: executes calls through the dapp-scoped
 * anonymizer and settles their proceeds into open notes in the same batch.
 */
export type Strk20SubaccountInvokeAction = {
  readonly calls: readonly Strk20InvokeCall[];
  readonly collect_policy: Strk20CollectPolicy;
  readonly dapp_name: string;
  readonly nonce: string;
  readonly type: "subaccount_invoke";
};

/**
 * STRK20_ACTION: the discriminated union of the five privacy actions, keyed on
 * the `type` field.
 */
export type Strk20Action =
  | Strk20DepositAction
  | Strk20InvokeAction
  | Strk20SubaccountInvokeAction
  | Strk20TransferAction
  | Strk20WithdrawAction;

const readDepositAction = (value: Record<string, unknown>): Strk20DepositAction | null => {
  if (
    !hasOnlyKnownKeys(value, ["amount", "recipient", "token", "type"]) ||
    !isStrk20Address(value["token"]) ||
    !isStrk20Amount(value["amount"])
  ) {
    return null;
  }
  const deposit = { amount: value["amount"], token: value["token"], type: "deposit" as const };
  if (value["recipient"] === undefined) {
    return deposit;
  }
  // A present-but-malformed recipient is rejected rather than dropped: silently
  // discarding it would credit the depositor while the caller expected a payment.
  return isStrk20Address(value["recipient"]) ? { ...deposit, recipient: value["recipient"] } : null;
};

const readWithdrawAction = (value: Record<string, unknown>): Strk20WithdrawAction | null =>
  hasOnlyKnownKeys(value, ["amount", "recipient", "token", "type"]) &&
  isStrk20Address(value["token"]) &&
  isStrk20Address(value["recipient"]) &&
  isStrk20Amount(value["amount"])
    ? {
        amount: value["amount"],
        recipient: value["recipient"],
        token: value["token"],
        type: "withdraw",
      }
    : null;

const readTransferAction = (value: Record<string, unknown>): Strk20TransferAction | null =>
  hasOnlyKnownKeys(value, ["amount", "recipient", "token", "type"]) &&
  isStrk20Address(value["token"]) &&
  isStrk20Address(value["recipient"]) &&
  isStrk20TransferAmount(value["amount"])
    ? {
        amount: value["amount"],
        recipient: value["recipient"],
        token: value["token"],
        type: "transfer",
      }
    : null;

const readInvokeAction = (value: Record<string, unknown>): Strk20InvokeAction | null =>
  hasOnlyKnownKeys(value, ["calldata", "contract", "type"]) &&
  isStrk20Address(value["contract"]) &&
  Array.isArray(value["calldata"]) &&
  value["calldata"].length <= STRK20_LIMITS.actionCalldataItems &&
  value["calldata"].every(isStrk20CalldataItem)
    ? { calldata: [...value["calldata"]], contract: value["contract"], type: "invoke" }
    : null;

const isAsciiDappName = (value: string): boolean =>
  value.length > 0 && value.length <= 31 && /^[\x20-\x7e]+$/.test(value);

/**
 * Checks a STRK20 dapp name: either one felt or a non-empty printable ASCII
 * Cairo short string no longer than 31 bytes.
 */
export const isStrk20DappName = (value: unknown): value is string =>
  typeof value === "string" && (isStrk20Felt(value) || isAsciiDappName(value));

const readCollectPolicy = (value: unknown): Strk20CollectPolicy | null => {
  if (!isRecord(value) || typeof value["type"] !== "string") {
    return null;
  }
  if ((value["type"] === "all" || value["type"] === "diff") && hasOnlyKnownKeys(value, ["type"])) {
    return { type: value["type"] };
  }
  return value["type"] === "exact" &&
    hasOnlyKnownKeys(value, ["amount", "type"]) &&
    isStrk20Amount(value["amount"])
    ? { amount: value["amount"], type: "exact" }
    : null;
};

const readSubaccountInvokeAction = (
  value: Record<string, unknown>,
): Strk20SubaccountInvokeAction | null => {
  if (
    !hasOnlyKnownKeys(value, ["calls", "collect_policy", "dapp_name", "nonce", "type"]) ||
    !isStrk20DappName(value["dapp_name"]) ||
    !isStrk20Felt(value["nonce"]) ||
    !Array.isArray(value["calls"]) ||
    value["calls"].length === 0 ||
    value["calls"].length > STRK20_LIMITS.subaccountCalls
  ) {
    return null;
  }
  const calls = value["calls"].map(readStrk20InvokeCall);
  const collectPolicy = readCollectPolicy(value["collect_policy"]);
  return calls.every((call): call is Strk20InvokeCall => call !== null) && collectPolicy
    ? {
        calls,
        collect_policy: collectPolicy,
        dapp_name: value["dapp_name"],
        nonce: value["nonce"],
        type: "subaccount_invoke",
      }
    : null;
};

/**
 * Strictly parses one STRK20_ACTION by its `type` discriminant, rejecting any
 * variant carrying unexpected keys or malformed fields.
 */
export const readStrk20Action = (value: unknown): Strk20Action | null => {
  if (!isRecord(value) || typeof value["type"] !== "string") {
    return null;
  }
  if (value["type"] === "deposit") {
    return readDepositAction(value);
  }
  if (value["type"] === "withdraw") {
    return readWithdrawAction(value);
  }
  if (value["type"] === "transfer") {
    return readTransferAction(value);
  }
  if (value["type"] === "invoke") {
    return readInvokeAction(value);
  }
  if (value["type"] === "subaccount_invoke") {
    return readSubaccountInvokeAction(value);
  }
  return null;
};

/**
 * Parses a non-empty (minItems 1) STRK20_ACTION list, rejecting the whole list
 * if any member is malformed.
 */
export const readStrk20Actions = (value: unknown): readonly Strk20Action[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > STRK20_LIMITS.actions) {
    return null;
  }
  const actions = value.map(readStrk20Action);
  return actions.every((action): action is Strk20Action => action !== null) ? actions : null;
};

/**
 * Parses an ADDRESS list used by the balances query. The canonical API uses an
 * empty array to request every shielded token balance.
 */
export const readStrk20Tokens = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value) || value.length > STRK20_LIMITS.tokens) {
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
export const isStrk20Proof = (value: unknown): value is Strk20Proof => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["data", "output", "proof_facts"]) ||
    typeof value["data"] !== "string" ||
    value["data"].length > STRK20_LIMITS.proofDataCharacters ||
    !Array.isArray(value["output"]) ||
    value["output"].length > STRK20_LIMITS.proofOutputFelts ||
    !value["output"].every(isStrk20Felt) ||
    !Array.isArray(value["proof_facts"]) ||
    value["proof_facts"].length > STRK20_LIMITS.proofFacts ||
    !value["proof_facts"].every(isStrk20Felt)
  ) {
    return false;
  }
  const empty =
    value["data"].length === 0 && value["output"].length === 0 && value["proof_facts"].length === 0;
  const proved =
    value["data"].length > 0 && value["output"].length > 0 && value["proof_facts"].length > 0;
  return empty || proved;
};

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
  readStrk20InvokeCall(value["call"]) !== null &&
  isStrk20Proof(value["proof"]);

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
  isStrk20Address(value["token"]) &&
  isStrk20Felt(value["balance"]);
