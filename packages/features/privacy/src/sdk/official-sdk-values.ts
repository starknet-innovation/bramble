/**
 * Validated value conversions at the official privacy-SDK boundary.
 */

import { WalletError } from "@bramble/core/errors";
import { buildErc20ApproveCall } from "@bramble/starknet/rpc-assets";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  STARK_FIELD_PRIME,
  STRK_TOKEN_ADDRESS,
} from "@bramble/wallet-model/networks";
import type { Strk20Action, Strk20BalanceEntry } from "@bramble/wallet-protocol/strk20";
import { STRK20_LIMITS } from "@bramble/wallet-protocol/strk20";
import type { BigNumberish, Call, RpcProvider } from "starknet";
import { num } from "starknet";
import type { Strk20NetworkConfig } from "../config";
import {
  canonicalStrk20PoolFee,
  STRK20_MAX_POOL_FEE,
  STRK20_SERVICE_UNAVAILABLE,
  type Strk20AccountContext,
} from "../service";
import { isRetryableStrk20ServiceError } from "./official-sdk-errors";
import {
  defaultServiceRetryPause,
  retryStrk20ServiceRead,
  type ServiceRetryPause,
} from "./official-sdk-retry";

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
  // Split: absent routing and an absent endpoint are different operator
  // problems, and reporting one line for both hid which was missing.
  if (!context.config) {
    throw new WalletError(
      `${STRK20_SERVICE_UNAVAILABLE}: no privacy routing is configured for this network`,
    );
  }
  if (context.rpcUrls.length === 0) {
    throw new WalletError(`${STRK20_SERVICE_UNAVAILABLE}: no RPC endpoint is configured`);
  }
  return context.config;
};

// Only nonzero notes count against the note cap, which applies per token. The
// pool lets any registered account write zero-amount notes to any other, under
// any nonzero token felt, and they can never be spent or removed, so counting
// them would let a third party push a victim's real balance past the cap
// (Sherlock 162).
const readNoteTotal = (tokenNotes: readonly SdkNote[]): bigint => {
  let total = 0n;
  let count = 0;
  for (const note of tokenNotes) {
    const amount = BigInt(note.amount);
    if (amount < 0n || amount >= STARK_FIELD_PRIME || total + amount >= STARK_FIELD_PRIME) {
      throw new Error("invalid note amount");
    }
    if (amount === 0n) {
      continue;
    }
    count += 1;
    if (count > STRK20_LIMITS.discoveredNotes) {
      throw new Error("too many notes");
    }
    total += amount;
  }
  return total;
};

// Totals only the tokens `counts` selects, and keeps only nonzero totals.
// Notes in other tokens are checked for shape but never summed or counted: a
// third party can open subchannels to anyone under made-up token felts, so
// those notes must not fail a read of the tokens the caller asked for.
const readNoteTotals = (
  notes: SdkNoteMap,
  counts: (token: bigint) => boolean,
): ReadonlyMap<bigint, bigint> => {
  const totals = new Map<bigint, bigint>();
  for (const [token, tokenNotes] of notes.entries()) {
    if (token <= 0n || token >= STARK_FIELD_PRIME || !Array.isArray(tokenNotes)) {
      throw new Error("invalid token note set");
    }
    if (!counts(token)) {
      continue;
    }
    const nextTotal = (totals.get(token) ?? 0n) + readNoteTotal(tokenNotes);
    if (nextTotal >= STARK_FIELD_PRIME) {
      throw new Error("private balance overflow");
    }
    if (nextTotal > 0n) {
      totals.set(token, nextTotal);
    }
  }
  return totals;
};

const readRequestedTokens = (requested: readonly string[]): ReadonlySet<bigint> => {
  if (requested.length > STRK20_LIMITS.tokens) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const keys = requested.map((token) => {
    if (!isNonZeroStarkFieldElement(token)) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    return BigInt(token);
  });
  const unique = new Set(keys);
  if (unique.size !== keys.length) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return unique;
};

/**
 * Sums SDK notes into canonical token balances and rejects malformed or
 * oversized SDK output before it reaches wallet state.
 *
 * With `requested` tokens, only those tokens are summed and the note cap
 * applies to each one's nonzero notes, so notes other accounts place in unrelated
 * or made-up tokens cannot fail the read. With none, every token holding a
 * nonzero balance is listed, and more than `STRK20_LIMITS.balances` of them
 * fails the read.
 */
export const balancesFrom = (
  notes: SdkNoteMap,
  requested: readonly string[],
): readonly Strk20BalanceEntry[] => {
  const requestedTokens = readRequestedTokens(requested);
  let totals: ReadonlyMap<bigint, bigint>;
  try {
    totals = readNoteTotals(
      notes,
      requestedTokens.size > 0 ? (token) => requestedTokens.has(token) : () => true,
    );
  } catch {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const tokens =
    requested.length > 0
      ? requested
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

// Every pool-fee failure is fatal to the submission, but they have different
// causes (no RPC configured, node unreachable or rate limiting, a pool that
// answers with something unusable). The suffix names which one without ever
// echoing the node URL, which may carry an API key.
const poolFeeUnavailable = (reason: string): WalletError =>
  new WalletError(`${STRK20_SERVICE_UNAVAILABLE}: could not read the pool fee (${reason})`);

const readPoolCall = async (
  providerFor: (nodeUrl: string) => RpcProvider,
  rpcUrls: readonly string[],
  poolAddress: string,
  entrypoint: "get_fee_amount" | "get_public_key",
  calldata: readonly string[],
  pauseForServiceRetry: ServiceRetryPause,
  unavailable: (reason: string) => WalletError,
): Promise<readonly string[]> => {
  const nodeUrl = rpcUrls[0];
  if (!nodeUrl) {
    throw unavailable("no RPC endpoint is configured");
  }
  try {
    return await retryStrk20ServiceRead(
      () =>
        providerFor(nodeUrl).callContract({
          calldata: [...calldata],
          contractAddress: poolAddress,
          entrypoint,
        }),
      pauseForServiceRetry,
    );
  } catch (error) {
    throw unavailable(
      isRetryableStrk20ServiceError(error)
        ? "rate limited; retry shortly"
        : `the node did not answer ${entrypoint}`,
    );
  }
};

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
  pauseForServiceRetry: ServiceRetryPause = defaultServiceRetryPause,
): Promise<bigint> => {
  const response = await readPoolCall(
    providerFor,
    rpcUrls,
    poolAddress,
    "get_fee_amount",
    [],
    pauseForServiceRetry,
    poolFeeUnavailable,
  );
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
  if (fee < 0n || fee > STRK20_MAX_POOL_FEE) {
    throw poolFeeUnavailable("the pool returned an out-of-range amount");
  }
  return fee;
};

/**
 * Re-reads the pool fee immediately before proving/submission and requires it
 * to equal the fee committed by the user's review. A change requires a fresh
 * review and no wallet authorization is produced on the stale preparation.
 */
export const requireReviewedStrk20PoolFee = async (
  providerFor: (nodeUrl: string) => RpcProvider,
  rpcUrls: readonly string[],
  poolAddress: string,
  reviewedPoolFeeFri: string,
  pauseForServiceRetry: ServiceRetryPause = defaultServiceRetryPause,
): Promise<bigint> => {
  const reviewed = canonicalStrk20PoolFee(reviewedPoolFeeFri);
  const current = await readStrk20PoolFee(providerFor, rpcUrls, poolAddress, pauseForServiceRetry);
  if (current !== BigInt(reviewed)) {
    throw new WalletError("Private pool fee changed. Review the transaction again.");
  }
  return current;
};

// Same shape as the pool-fee failures: fatal, and worth naming the cause
// without ever echoing the node URL, which may carry an API key.
const registrationUnreadable = (reason: string): WalletError =>
  new WalletError(`${STRK20_SERVICE_UNAVAILABLE}: could not read pool registration (${reason})`);

/**
 * Reads the public viewing key an address registered with the pool
 * (`get_public_key`), canonical, or `0x0` when it never registered. The pool
 * writes it once, so a non-zero answer is permanent for that pool. An
 * unreachable or malformed response throws rather than guessing.
 */
export const readStrk20PublicKey = async (
  providerFor: (nodeUrl: string) => RpcProvider,
  rpcUrls: readonly string[],
  poolAddress: string,
  address: string,
  pauseForServiceRetry: ServiceRetryPause = defaultServiceRetryPause,
): Promise<string> => {
  if (!isNonZeroStarkFieldElement(address)) {
    throw registrationUnreadable("the address is not a field element");
  }
  const response = await readPoolCall(
    providerFor,
    rpcUrls,
    poolAddress,
    "get_public_key",
    [address],
    pauseForServiceRetry,
    registrationUnreadable,
  );
  const felt = response.length === 1 ? response[0] : undefined;
  if (felt === undefined) {
    throw registrationUnreadable("the pool returned an unexpected result shape");
  }
  if (!isStarkFieldElement(felt)) {
    throw registrationUnreadable("the pool returned an out-of-field public key");
  }
  return canonicalFelt(felt) as string;
};

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
  pauseForServiceRetry: ServiceRetryPause = defaultServiceRetryPause,
): Promise<boolean> =>
  BigInt(
    await readStrk20PublicKey(providerFor, rpcUrls, poolAddress, address, pauseForServiceRetry),
  ) !== 0n;

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
