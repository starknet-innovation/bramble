/**
 * Validated value conversions at the official privacy-SDK boundary.
 */

import type { BigNumberish, Call, RpcProvider } from "starknet";
import { num } from "starknet";
import { WalletError } from "../../shared/errors";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  STARK_FIELD_PRIME,
  STRK_TOKEN_ADDRESS,
} from "../networks";
import { buildErc20ApproveCall } from "../rpc-assets";
import type { Strk20NetworkConfig } from "./config";
import type { Strk20Action, Strk20BalanceEntry } from "./schemas";
import { STRK20_LIMITS } from "./schemas";
import { STRK20_SERVICE_UNAVAILABLE, type Strk20AccountContext } from "./service";

type SdkNote = { readonly amount: BigNumberish };

/**
 * Minimal iterable note map accepted from the SDK discovery boundary.
 */
export type SdkNoteMap = {
  readonly entries: () => IterableIterator<[bigint, readonly SdkNote[]]>;
};

/**
 * Requires a complete network configuration before an SDK operation can read
 * private state or produce a proof.
 */
export const requireStrk20Config = (context: Strk20AccountContext): Strk20NetworkConfig => {
  if (!context.config || context.rpcUrls.length === 0) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return context.config;
};

const readNoteTotal = (
  tokenNotes: readonly SdkNote[],
  initialCount: number,
): { readonly count: number; readonly total: bigint } => {
  let total = 0n;
  let count = initialCount;
  for (const note of tokenNotes) {
    count += 1;
    if (count > STRK20_LIMITS.discoveredNotes) {
      throw new Error("too many notes");
    }
    const amount = BigInt(note.amount);
    if (amount < 0n || amount >= STARK_FIELD_PRIME || total + amount >= STARK_FIELD_PRIME) {
      throw new Error("invalid note amount");
    }
    total += amount;
  }
  return { count, total };
};

const readNoteTotals = (notes: SdkNoteMap): ReadonlyMap<bigint, bigint> => {
  const totals = new Map<bigint, bigint>();
  let discoveredNotes = 0;
  for (const [token, tokenNotes] of notes.entries()) {
    if (
      (!totals.has(token) && totals.size >= STRK20_LIMITS.balances) ||
      token <= 0n ||
      token >= STARK_FIELD_PRIME ||
      !Array.isArray(tokenNotes)
    ) {
      throw new Error("invalid token note set");
    }
    const tokenTotal = readNoteTotal(tokenNotes, discoveredNotes);
    discoveredNotes = tokenTotal.count;
    const nextTotal = (totals.get(token) ?? 0n) + tokenTotal.total;
    if (nextTotal >= STARK_FIELD_PRIME) {
      throw new Error("private balance overflow");
    }
    totals.set(token, nextTotal);
  }
  return totals;
};

const readRequestedTokens = (requested: readonly string[]): readonly string[] => {
  if (requested.length > STRK20_LIMITS.tokens) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const keys = requested.map((token) => {
    if (!isNonZeroStarkFieldElement(token)) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    return BigInt(token);
  });
  if (new Set(keys).size !== keys.length) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return requested;
};

/**
 * Sums SDK notes into canonical token balances and rejects malformed or
 * oversized SDK output before it reaches wallet state.
 */
export const balancesFrom = (
  notes: SdkNoteMap,
  requested: readonly string[],
): readonly Strk20BalanceEntry[] => {
  let totals: ReadonlyMap<bigint, bigint>;
  try {
    totals = readNoteTotals(notes);
  } catch {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const requestedTokens = readRequestedTokens(requested);
  const tokens =
    requestedTokens.length > 0
      ? requestedTokens
      : [...totals.keys()]
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
          .map((token) => `0x${token.toString(16)}`);
  if (tokens.length > STRK20_LIMITS.balances) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return tokens.map((token) => ({
    balance: `0x${(totals.get(BigInt(token)) ?? 0n).toString(16)}`,
    token,
  }));
};

const MAX_POOL_FEE = (1n << 128n) - 1n;

// Every pool-fee failure is fatal to the submission, but they have different
// causes (no RPC configured, node unreachable or rate limiting, a pool that
// answers with something unusable). The suffix names which one without ever
// echoing the node URL, which may carry an API key.
const poolFeeUnavailable = (reason: string): WalletError =>
  new WalletError(`${STRK20_SERVICE_UNAVAILABLE}: could not read the pool fee (${reason})`);

/**
 * Reads the pool's per-`apply_actions` STRK charge (`get_fee_amount`), which
 * the pool pulls from the caller via `transfer_from` in the same transaction.
 * Read fresh per submission so governance fee changes never desynchronize the
 * prepended approval; an unreachable or malformed response fails closed
 * before any transaction is signed, with the cause named in the message.
 */
export const readStrk20PoolFee = async (
  providerFor: (nodeUrl: string) => RpcProvider,
  rpcUrls: readonly string[],
  poolAddress: string,
): Promise<bigint> => {
  const nodeUrl = rpcUrls[0];
  if (!nodeUrl) {
    throw poolFeeUnavailable("no RPC endpoint is configured");
  }
  let response: readonly string[];
  try {
    response = await providerFor(nodeUrl).callContract({
      calldata: [],
      contractAddress: poolAddress,
      entrypoint: "get_fee_amount",
    });
  } catch {
    throw poolFeeUnavailable("the node did not answer get_fee_amount");
  }
  const felt = response.length === 1 ? response[0] : undefined;
  if (felt === undefined) {
    throw poolFeeUnavailable("the pool returned an unexpected result shape");
  }
  let fee: bigint;
  try {
    fee = BigInt(felt);
  } catch {
    throw poolFeeUnavailable("the pool returned a malformed amount");
  }
  if (fee < 0n || fee > MAX_POOL_FEE) {
    throw poolFeeUnavailable("the pool returned an out-of-range amount");
  }
  return fee;
};

// Same shape as the pool-fee failures: fatal, and worth naming the cause
// without ever echoing the node URL, which may carry an API key.
const registrationUnreadable = (reason: string): WalletError =>
  new WalletError(`${STRK20_SERVICE_UNAVAILABLE}: could not read pool registration (${reason})`);

/**
 * Reads whether an address has a viewing key registered with the pool
 * (`get_public_key`, zero when unregistered).
 *
 * This is the only unambiguous registration answer available for a *third
 * party*. The SDK's `discoverRequirement` cannot serve that purpose: the
 * discovery service collapses "recipient has no public key" and "no
 * sender→recipient channel exists yet" into the same `SetupChannel` response,
 * and because a channel key is derived per sender/recipient pair, the first
 * private transfer between any two accounts always reports `SetupChannel`.
 * Reading the pool directly separates the two. An unreachable or malformed
 * response fails closed rather than guessing a recipient is reachable.
 */
export const readStrk20Registered = async (
  providerFor: (nodeUrl: string) => RpcProvider,
  rpcUrls: readonly string[],
  poolAddress: string,
  address: string,
): Promise<boolean> => {
  const nodeUrl = rpcUrls[0];
  if (!nodeUrl) {
    throw registrationUnreadable("no RPC endpoint is configured");
  }
  if (!isNonZeroStarkFieldElement(address)) {
    throw registrationUnreadable("the address is not a field element");
  }
  let response: readonly string[];
  try {
    response = await providerFor(nodeUrl).callContract({
      calldata: [address],
      contractAddress: poolAddress,
      entrypoint: "get_public_key",
    });
  } catch {
    throw registrationUnreadable("the node did not answer get_public_key");
  }
  const felt = response.length === 1 ? response[0] : undefined;
  if (felt === undefined) {
    throw registrationUnreadable("the pool returned an unexpected result shape");
  }
  if (!isStarkFieldElement(felt)) {
    throw registrationUnreadable("the pool returned an out-of-field public key");
  }
  return BigInt(felt) !== 0n;
};

/**
 * The pool fee to approve on the relay route: none.
 *
 * The pool charges `get_caller_address()` of `apply_actions`. On this route
 * that caller is the relay, which funds the fee and is reimbursed from the
 * sender's private balance by the quoted fee action. A sender approval would
 * instead select `invoke_and_apply_action`, publish the sender in calldata and
 * an Approval event, and leave an unused public allowance behind.
 */
export const RELAY_PAYS_POOL_FEE = 0n;

/**
 * Aggregates deposit approvals by token so the submitting account grants only
 * the exact amounts consumed by the reviewed batch. `poolFeeFri` is the pool's
 * per-`apply_actions` STRK charge and must be non-zero only when that account is
 * the caller. Relay callers must pass {@link RELAY_PAYS_POOL_FEE}; deposits
 * retain their own approvals because the pool pulls those tokens from the
 * sender.
 */
export const approveCalls = (
  actions: readonly Strk20Action[],
  poolAddress: string,
  poolFeeFri: bigint,
): readonly Call[] => {
  const approvals = new Map<bigint, bigint>();
  if (poolFeeFri > 0n) {
    approvals.set(BigInt(STRK_TOKEN_ADDRESS), poolFeeFri);
  }
  for (const action of actions) {
    if (action.type === "deposit") {
      const token = BigInt(action.token);
      approvals.set(token, (approvals.get(token) ?? 0n) + BigInt(action.amount));
    }
  }
  return [...approvals].map(([token, amount]) =>
    buildErc20ApproveCall(num.toHex(token), poolAddress, amount),
  );
};
