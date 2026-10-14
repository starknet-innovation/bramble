/**
 * Privacy proof maturity runtime. The official SDK proves against historical
 * state, so every prior write is accepted and then allowed to age beyond that
 * proving block before a dependent proof is created.
 */

import { WalletError } from "@bramble/core/errors";
import { IndeterminateRpcWriteError, isTransportRpcError } from "@bramble/starknet/provider";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
} from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import {
  memoryStrk20MaturityStore,
  STRK20_PRIOR_WRITE_UNRESOLVED,
  type Strk20MaturityScope,
  type Strk20MaturityStore,
  type Strk20SignedSubmission,
  type Strk20SubmissionRoute,
} from "../policy/maturity";
import { STRK20_SERVICE_UNAVAILABLE } from "../service";
import {
  STRK20_WAIT_BUDGETS,
  type WaitScheduler,
  withinStrk20WaitBudget,
} from "./official-sdk-budget";

export { strk20ProofBaseBlock } from "./official-sdk-maturity-resolution";

import {
  PROVING_BLOCK_DEPTH,
  priorWaitFailure,
  RejectedPrivacyTransaction,
  settleSubmitting,
} from "./official-sdk-maturity-resolution";

const MAX_MATURITY_POLLS = 120;
const ACCEPTANCE_RETRIES = 240;
const ACCEPTANCE_LIFECYCLE_RETRIES = 120;

/**
 * Persists the signed identity of a privacy write before it is sent. Handed to
 * each broadcast by {@link Strk20MaturityRuntime.submitAccepted}; a send that
 * signs its own transaction passes it on as the invoke's `onSigned` hook. A
 * malformed identity is refused, which aborts the send before anything leaves.
 */
export type Strk20SubmissionJournal = (signed: Strk20SignedSubmission) => Promise<void>;

// Canonical form only: the store validates on read and drops what it cannot
// parse, so a non-canonical felt written here would read back as a clean scope.
const canonicalSigned = (signed: Strk20SignedSubmission): Strk20SignedSubmission | null => {
  const transactionHash = canonicalFelt(signed.transactionHash);
  const senderAddress = canonicalFelt(signed.senderAddress);
  const nonce = canonicalFelt(signed.nonce);
  return transactionHash &&
    isNonZeroStarkFieldElement(transactionHash) &&
    senderAddress &&
    isNonZeroStarkFieldElement(senderAddress) &&
    nonce &&
    isStarkFieldElement(nonce)
    ? { nonce, senderAddress, transactionHash }
    : null;
};

// Journals a signed write for `scope`. A malformed identity is refused, which
// aborts the send before anything leaves.
const journalFor =
  (
    store: Strk20MaturityStore,
    scope: Strk20MaturityScope,
    proved: { readonly proofBaseBlock?: number },
  ): Strk20SubmissionJournal =>
  async (signed) => {
    const identity = canonicalSigned(signed);
    if (!identity) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    await store.write(scope, { ...identity, ...proved, state: "submitting" });
  };

type MaturityRuntimeOptions = {
  /**
   * Wall-clock ceiling on one proving-block wait, receipt wait included. The
   * poll count alone is not a bound: each poll is two node reads that can
   * each take the transport's full deadline before answering "not yet".
   */
  readonly maturityBudgetMs?: number;
  readonly pause?: () => Promise<void>;
  readonly schedule?: WaitScheduler;
  readonly store?: Strk20MaturityStore;
  readonly waitForAccepted?: (provider: RpcProvider, transactionHash: string) => Promise<number>;
};

const defaultPause = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 1_000);
  });

const defaultWaitForAccepted = async (
  provider: RpcProvider,
  transactionHash: string,
): Promise<number> => {
  const receipt = await provider.waitForTransaction(transactionHash, {
    lifeCycleRetries: ACCEPTANCE_LIFECYCLE_RETRIES,
    retries: ACCEPTANCE_RETRIES,
    retryInterval: 250,
  });
  if (!receipt.isSuccess()) {
    throw new RejectedPrivacyTransaction();
  }
  if (!Number.isSafeInteger(receipt.block_number)) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return receipt.block_number;
};

/**
 * Receipt and proving-block coordinator used by one SDK service instance.
 */
export type Strk20MaturityRuntime = {
  readonly provingBlock: (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    isHistoricalStateReady?: (block: number) => Promise<boolean>,
  ) => Promise<number>;
  readonly recordSubmission: (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    transactionHash: string,
  ) => Promise<void>;
  /**
   * Prepares and broadcasts one write for `scope`, serialized per scope. The
   * scope is marked `submitting` before `broadcast` runs; a broadcast that
   * signs its own transaction should pass `journal` on as the invoke's
   * `onSigned` hook, so a send whose answer is lost can later be resolved
   * on-chain rather than only by ending the browser session.
   *
   * `route` is recorded on the claim. Pass `account` only when `broadcast`
   * signs through `journal` (the invoke's `onSigned` hook), because an
   * `account` claim that never gained a signed identity is later released as
   * provably unsent. Anything else must pass `relay`.
   *
   * `proofBaseBlockOf` names the base block of the proof `prepared` carries
   * ({@link strk20ProofBaseBlock}). It is recorded on the claim and its
   * journaled identity, so a signed write whose nonce stays unspent can be
   * released once the pool refuses that proof in every later block.
   */
  readonly submitAccepted: <P, T extends { readonly transactionHash: string }>(
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    route: Strk20SubmissionRoute,
    prepare: () => Promise<P>,
    broadcast: (prepared: P, journal: Strk20SubmissionJournal) => Promise<T>,
    proofBaseBlockOf?: (prepared: P) => number | null,
  ) => Promise<T>;
};

/**
 * Creates the accepted-receipt and historical-state readiness coordinator.
 */
export const createStrk20MaturityRuntime = ({
  maturityBudgetMs = STRK20_WAIT_BUDGETS.maturity,
  pause = defaultPause,
  schedule,
  store = memoryStrk20MaturityStore(),
  waitForAccepted = defaultWaitForAccepted,
}: MaturityRuntimeOptions = {}): Strk20MaturityRuntime => {
  const submissionTails = new Map<string, Promise<void>>();
  // Scopes whose send is between its `submitting` claim and its settled
  // broadcast in this worker. Such a claim may still be signed, so it is never
  // released as unsent. The background builds one runtime per worker, and a
  // send cannot outlive the worker that runs it.
  const liveSends = new Set<string>();
  const scopeKey = (scope: Strk20MaturityScope): string =>
    `${scope.accountId}|${scope.networkId}|${canonicalFelt(scope.poolAddress) ?? scope.poolAddress}`;
  const serializeSubmission = <T>(
    scope: Strk20MaturityScope,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const key = scopeKey(scope);
    const previous = submissionTails.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    submissionTails.set(key, tail);
    void tail.then(() => {
      if (submissionTails.get(key) === tail) {
        submissionTails.delete(key);
      }
    });
    return result;
  };
  const acceptedBlock = async (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    transactionHash: string,
  ): Promise<number> => {
    const block = await waitForAccepted(provider, transactionHash);
    if (!Number.isSafeInteger(block) || block < 0) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    // The receipt wait is a gap. Record the block only while this hash is
    // still the scope's marker; a newer send's marker must survive it. If a
    // newer send replaced the marker meanwhile, this block says nothing about
    // that send's acceptance, so fail closed instead of returning it as a
    // proving floor (mc-wallet #474 item 1).
    const recorded = await store.replaceIfCurrentHash(scope, transactionHash, {
      acceptedBlock: block,
      state: "submitted",
      transactionHash,
    });
    if (!recorded) {
      throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
    }
    return block;
  };

  const priorAcceptedBlock = async (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
  ): Promise<number | undefined> => {
    const stored = await store.read(scope);
    const record =
      stored?.state === "submitting"
        ? await settleSubmitting(store, provider, scope, stored, liveSends.has(scopeKey(scope)))
        : stored;
    if (!record) {
      return undefined;
    }
    if (record.acceptedBlock !== undefined) {
      return record.acceptedBlock;
    }
    try {
      return await acceptedBlock(provider, scope, record.transactionHash);
    } catch (error) {
      return priorWaitFailure(store, scope, record.transactionHash, error);
    }
  };

  // One poll: the deepest block the prover may target right now, if it is
  // already past the prior write and its historical state is visible.
  const matureCandidate = async (
    provider: RpcProvider,
    priorBlock: number | undefined,
    isHistoricalStateReady?: (block: number) => Promise<boolean>,
  ): Promise<number | null> => {
    const latest = await provider.getBlockNumber();
    const candidate = Math.max(0, latest - PROVING_BLOCK_DEPTH);
    const pastPrior = priorBlock === undefined || priorBlock < candidate;
    return pastPrior && (!isHistoricalStateReady || (await isHistoricalStateReady(candidate)))
      ? candidate
      : null;
  };
  // Bounded twice over: by poll count, and by wall clock through the budget,
  // whose lapse is the answer the caller gets when the node keeps saying "not
  // yet". The loop also reads the budget so it stops polling once the race has
  // already been lost rather than spending the remaining polls on a dead wait.
  const provingBlock = (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    isHistoricalStateReady?: (block: number) => Promise<boolean>,
  ): Promise<number> =>
    withinStrk20WaitBudget(
      "waiting for pool maturity",
      maturityBudgetMs,
      async (budget) => {
        const priorBlock = await priorAcceptedBlock(provider, scope);
        for (let attempt = 0; attempt <= MAX_MATURITY_POLLS && !budget.expired(); attempt += 1) {
          const candidate = await matureCandidate(provider, priorBlock, isHistoricalStateReady);
          if (candidate !== null) {
            return candidate;
          }
          if (attempt === MAX_MATURITY_POLLS) {
            break;
          }
          await pause();
        }
        throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
      },
      schedule,
    );
  const recordSubmission = async (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    transactionHash: string,
  ): Promise<void> => {
    if (!isNonZeroStarkFieldElement(transactionHash)) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    await store.write(scope, { state: "submitted", transactionHash });
    try {
      await acceptedBlock(provider, scope, transactionHash);
    } catch (error) {
      if (error instanceof RejectedPrivacyTransaction) {
        await store.replaceIfCurrentHash(scope, transactionHash, null);
      }
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
  };
  const submitPreparedAccepted = <P, T extends { readonly transactionHash: string }>(
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    route: Strk20SubmissionRoute,
    prepare: () => Promise<P>,
    broadcast: (prepared: P, journal: Strk20SubmissionJournal) => Promise<T>,
    proofBaseBlockOf?: (prepared: P) => number | null,
  ): Promise<T> =>
    serializeSubmission(scope, async () => {
      const prepared = await prepare();
      const previous = await store.read(scope);
      const key = scopeKey(scope);
      const proofBaseBlock = proofBaseBlockOf?.(prepared) ?? undefined;
      const proved = proofBaseBlock === undefined ? {} : { proofBaseBlock };
      // Marked live before the claim is queued, so a resolution that reads the
      // flag afterwards can never queue a release ahead of this claim.
      liveSends.add(key);
      // A structured RPC rejection is determinate: the sequencer refused the
      // transaction, so no write is in flight and the scope must be released or
      // every later attempt on it fails with a stale `submitting` guard.
      // Transport and unknown failures stay indeterminate — the transaction may
      // have been accepted after the response was lost — so those keep the scope
      // closed rather than risk proving against state a landed write invalidates.
      // The scope stays live until that restore has landed.
      const result = await (async (): Promise<T> => {
        await store.write(scope, { ...proved, route, state: "submitting" });
        return broadcast(prepared, journalFor(store, scope, proved)).catch(
          async (error: unknown) => {
            if (!(error instanceof IndeterminateRpcWriteError) && !isTransportRpcError(error)) {
              await store.write(scope, previous);
            }
            throw error;
          },
        );
      })().finally(() => {
        liveSends.delete(key);
      });
      // The pre-broadcast `submitting` claim is already durable. Once the RPC
      // returned an accepted hash, a later journal/receipt failure may leave
      // the scope conservatively closed, but it must not rewrite the broadcast
      // into a retryable failure and risk a duplicate economic action.
      await recordSubmission(provider, scope, result.transactionHash).catch(() => undefined);
      return result;
    });

  return {
    provingBlock,
    recordSubmission,
    submitAccepted: submitPreparedAccepted,
  };
};
