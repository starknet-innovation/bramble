/**
 * Validated value conversions at the official privacy-SDK boundary.
 */

import type { BigNumberish, Call, RpcProvider } from "starknet";
import { num } from "starknet";
import { WalletError } from "../../shared/errors";
import { isNonZeroStarkFieldElement, STARK_FIELD_PRIME, STRK_TOKEN_ADDRESS } from "../networks";
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

/**
 * Reads the pool's per-`apply_actions` STRK charge (`get_fee_amount`), which
 * the pool pulls from the caller via `transfer_from` in the same transaction.
 * Read fresh per submission so governance fee changes never desynchronize the
 * prepended approval; an unreachable or malformed response fails closed
 * before any transaction is signed.
 */
export const readStrk20PoolFee = async (
  providerFor: (nodeUrl: string) => RpcProvider,
  rpcUrls: readonly string[],
  poolAddress: string,
): Promise<bigint> => {
  const nodeUrl = rpcUrls[0];
  if (!nodeUrl) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  let response: readonly string[];
  try {
    response = await providerFor(nodeUrl).callContract({
      calldata: [],
      contractAddress: poolAddress,
      entrypoint: "get_fee_amount",
    });
  } catch {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const felt = response.length === 1 ? response[0] : undefined;
  if (felt === undefined) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  let fee: bigint;
  try {
    fee = BigInt(felt);
  } catch {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  if (fee < 0n || fee > MAX_POOL_FEE) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return fee;
};

/**
 * Aggregates deposit approvals by token so the public account route grants
 * only the exact amounts consumed by the reviewed batch. `poolFeeFri` is the
 * pool's per-`apply_actions` STRK charge (`get_fee_amount`), folded into the
 * STRK approval because the pool pulls it from the caller via `transfer_from`
 * in the same transaction — every action batch, registration included, fails
 * on-chain without it.
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
