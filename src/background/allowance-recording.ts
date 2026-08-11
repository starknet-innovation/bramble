/**
 * Allowance bookkeeping for calls this wallet has just broadcast. Every path
 * that submits calls the user did not build here — the dapp invoke, the swap,
 * a multisig execution, a privacy-pool deposit — files what those calls granted,
 * because an allowance the log never saw can neither be listed nor revoked from
 * the manager, and it also leaves the running total a later `increase_allowance`
 * is added to wrong. `tests/conformance/allowance-recording-coverage.test.ts`
 * refuses a new submitting path that skips this module.
 *
 * Trust boundary: the calls are untrusted, already-submitted input; nothing here
 * signs, submits, or refuses anything. Failure behaviour: best-effort by
 * design — bookkeeping must never mask a transaction that is already on its way
 * — so a read or write failure is swallowed per change and leaves that entry
 * untracked rather than downgraded.
 */
import type { Call } from "starknet";
import { allowanceChangesFromCalls } from "../starknet/allowances";
import type { StarknetNetworkId } from "../starknet/networks";
import type { AllowanceOwner, AllowanceStore } from "../storage/allowance-store";

/**
 * Records every allowance-changing call in a submitted transaction — `approve`,
 * both spellings of `increase_allowance`, and both spellings of
 * `decrease_allowance` — against the scope that owns the allowance, so the
 * manager can list and revoke it later.
 *
 * ERC20 semantics decide the stored amount: an `approve` replaces it (zero
 * clears the entry), an increase adds to it, a decrease subtracts from it. The
 * relative cases go through `applyDelta`, which applies the arithmetic inside
 * the store's own mutation queue — composing a `list` and a `record` here would
 * let two concurrently handled grants read the same base and lose one of them.
 */
export const recordApproveAllowances = async (
  store: AllowanceStore,
  calls: readonly Call[],
  owner: AllowanceOwner,
): Promise<void> => {
  for (const { input, kind } of allowanceChangesFromCalls(calls, owner)) {
    try {
      if (kind === "set") {
        await store.record(input);
      } else {
        await store.applyDelta({ direction: kind === "increase" ? "add" : "subtract", input });
      }
    } catch {
      // Nothing to report: the transaction is already on its way.
    }
  }
};

/**
 * Scopes an account (or watched multisig) record to the allowance log's owner
 * shape, so callers name the granting scope explicitly instead of passing a
 * whole `AccountRef` through the bookkeeping boundary.
 */
export const allowanceOwner = (owner: {
  readonly id: string;
  readonly networkId: StarknetNetworkId;
}): AllowanceOwner => ({ accountId: owner.id, networkId: owner.networkId });
