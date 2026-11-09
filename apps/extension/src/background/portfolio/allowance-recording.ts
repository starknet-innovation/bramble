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

import type { AllowanceOwner, AllowanceStore } from "@bramble/transactions/allowance-store";
import { type ApprovedAssets, allowanceChangesFromCalls } from "@bramble/transactions/allowances";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";

/**
 * One bookkeeping request: the log to write, the submitted calls, the scope
 * that owns whatever they granted, the registries that say which of those
 * contracts are tokens at all, and the hash of the transaction that carried
 * the calls. The hash is required so no submitting path can file a revoke the
 * log could never settle on its outcome (issue 647).
 *
 * `assets` is required, not optional, so a new submitting path cannot file an
 * NFT collection approval as a spending allowance simply by forgetting to pass
 * the account's trusted set — build it with `verificationContext`, the one
 * definition of what an account trusts.
 */
export type AllowanceRecording = {
  readonly assets: ApprovedAssets;
  readonly calls: readonly Call[];
  readonly owner: AllowanceOwner;
  readonly store: AllowanceStore;
  readonly transactionHash: string;
};

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
 *
 * An approve-shaped call on a collection the account watches is filed as
 * nothing at all: it grants an NFT item, not spend, and the two share a
 * calldata shape (see `allowanceChangesFromCalls`).
 */
export const recordApproveAllowances = async ({
  assets,
  calls,
  owner,
  store,
  transactionHash,
}: AllowanceRecording): Promise<void> => {
  for (const { input, kind } of allowanceChangesFromCalls(calls, owner, assets)) {
    try {
      if (kind === "set") {
        await store.record(input, transactionHash);
      } else {
        await store.applyDelta({
          direction: kind === "increase" ? "add" : "subtract",
          input,
          transactionHash,
        });
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
