/**
 * Validated value conversions at the official privacy-SDK boundary.
 */

import type { BigNumberish, Call } from "starknet";
import { num } from "starknet";
import { WalletError } from "../../shared/errors";
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

/**
 * Sums SDK notes into canonical token balances and rejects malformed or
 * oversized SDK output before it reaches wallet state.
 */
export const balancesFrom = (
  notes: SdkNoteMap,
  requested: readonly string[],
): readonly Strk20BalanceEntry[] => {
  const totals = new Map<bigint, bigint>();
  try {
    for (const [token, tokenNotes] of notes.entries()) {
      let total = 0n;
      for (const note of tokenNotes) {
        const amount = BigInt(note.amount);
        if (amount < 0n) {
          throw new Error("negative note");
        }
        total += amount;
      }
      totals.set(token, total);
    }
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

/**
 * Aggregates deposit approvals by token so the public account route grants
 * only the exact amounts consumed by the reviewed batch.
 */
export const approveCalls = (
  actions: readonly Strk20Action[],
  poolAddress: string,
): readonly Call[] => {
  const deposits = new Map<bigint, bigint>();
  for (const action of actions) {
    if (action.type === "deposit") {
      const token = BigInt(action.token);
      deposits.set(token, (deposits.get(token) ?? 0n) + BigInt(action.amount));
    }
  }
  return [...deposits].map(([token, amount]) =>
    buildErc20ApproveCall(num.toHex(token), poolAddress, amount),
  );
};
