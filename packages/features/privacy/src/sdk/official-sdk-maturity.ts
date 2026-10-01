/**
 * Privacy proof maturity runtime. The official SDK proves against historical
 * state, so every prior write is accepted and then allowed to age beyond that
 * proving block before a dependent proof is created.
 */

import { WalletError } from "@bramble/core/errors";
import {
  IndeterminateRpcWriteError,
  isTransactionNotFoundError,
  isTransportRpcError,
} from "@bramble/starknet/provider";
import { classifyTransactionStatus } from "@bramble/starknet/rpc";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
} from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import {
  memoryStrk20MaturityStore,
  type Strk20MaturityRecord,
  type Strk20MaturityScope,
  type Strk20MaturityStore,
  type Strk20SignedSubmission,
} from "../policy/maturity";
import { STRK20_SERVICE_UNAVAILABLE } from "../service";
import {
  STRK20_WAIT_BUDGETS,
  type WaitScheduler,
  withinStrk20WaitBudget,
} from "./official-sdk-budget";

const PROVING_BLOCK_DEPTH = 10;
const MAX_MATURITY_POLLS = 120;
const ACCEPTANCE_RETRIES = 240;
const ACCEPTANCE_LIFECYCLE_RETRIES = 120;

class RejectedPrivacyTransaction extends Error {}

const STATUS_UNKNOWN = `${STRK20_SERVICE_UNAVAILABLE}: submission status is unknown; close every browser window and reopen the browser to recover`;

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

type SignedOutcome = "dropped" | "landed" | "rejected" | "unknown";

// A nonce answer is an untrusted RPC value. Only a string that canonicalizes
// to a field element can prove the sender's nonce moved; a decimal or an
// integer past the field is not a nonce, and treating it as one could release
// a write that may still land.
const chainNonce = (value: unknown): bigint | null => {
  if (typeof value !== "string") {
    return null;
  }
  const felt = canonicalFelt(value);
  return felt !== null && isStarkFieldElement(felt) ? BigInt(felt) : null;
};

// What the chain says about a write whose send lost its answer. A status the
// node answers is followed like any submitted write, except REJECTED: the
// sequencer refused that hash, it will not be included, and its nonce was not
// spent, so the signed marker is released instead of being replaced by a
// submitted record that no longer carries the nonce. "Not found" alone is
// noise — a hash can be unknown to one node for a moment, or to one backend
// behind a balancer — so the write counts as dropped only when the sender's
// nonce was already spent past it in a block PROVING_BLOCK_DEPTH deep, and the
// node, asked again after that, still does not know the hash. A nonce is spent
// once, so such a write can never land. Everything else, including any failed
// read or a nonce that is not a field element, stays unknown and closed.
const resolveSigned = async (
  provider: RpcProvider,
  signed: Strk20SignedSubmission,
): Promise<SignedOutcome> => {
  const lookUp = async (): Promise<SignedOutcome> => {
    try {
      const status = classifyTransactionStatus(
        await provider.getTransactionStatus(signed.transactionHash),
      ).status;
      switch (status) {
        case "rejected":
          return "rejected";
        case "accepted":
        case "pending":
        case "preconfirmed":
        case "reverted":
          return "landed";
        default: {
          const unreachable: never = status;
          return unreachable;
        }
      }
    } catch (error) {
      return isTransactionNotFoundError(error) ? "dropped" : "unknown";
    }
  };
  const first = await lookUp();
  if (first !== "dropped") {
    return first;
  }
  try {
    const settled = (await provider.getBlockNumber()) - PROVING_BLOCK_DEPTH;
    if (!Number.isSafeInteger(settled) || settled < 0) {
      return "unknown";
    }
    const spent = chainNonce(await provider.getNonceForAddress(signed.senderAddress, settled));
    if (spent === null || spent <= BigInt(signed.nonce)) {
      return "unknown";
    }
  } catch {
    return "unknown";
  }
  return lookUp();
};

type SubmittingRecord = Extract<Strk20MaturityRecord, { readonly state: "submitting" }>;
type SubmittedRecord = Extract<Strk20MaturityRecord, { readonly state: "submitted" }>;

// Journals a signed write for `scope`. A malformed identity is refused, which
// aborts the send before anything leaves.
const journalFor =
  (store: Strk20MaturityStore, scope: Strk20MaturityScope): Strk20SubmissionJournal =>
  async (signed) => {
    const identity = canonicalSigned(signed);
    if (!identity) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    await store.write(scope, { ...identity, state: "submitting" });
  };

// Replaces a stuck marker only while the store still names it. The comparison
// is inside the store's mutation, not a read followed by a later write: a send
// that started meanwhile has written its own marker, which must survive.
const replaceStuck = async (
  store: Strk20MaturityStore,
  scope: Strk20MaturityScope,
  transactionHash: string,
  next: SubmittedRecord | null,
): Promise<void> => {
  if (!(await store.replaceIfCurrentHash(scope, transactionHash, next))) {
    throw new WalletError(STATUS_UNKNOWN);
  }
};

const settledRecord = (
  outcome: Exclude<SignedOutcome, "unknown">,
  transactionHash: string,
): SubmittedRecord | null => {
  switch (outcome) {
    case "landed":
      return { state: "submitted", transactionHash };
    case "dropped":
    case "rejected":
      return null;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
};

// Settles a `submitting` marker on-chain: the submitted write to follow, null
// once the write provably cannot land, or STATUS_UNKNOWN while it stays
// closed. A marker without a signed identity (a relay send, or one that failed
// before signing) names nothing the chain can be asked about.
const settleSubmitting = async (
  store: Strk20MaturityStore,
  provider: RpcProvider,
  scope: Strk20MaturityScope,
  marker: SubmittingRecord,
): Promise<SubmittedRecord | null> => {
  if (marker.transactionHash === undefined) {
    throw new WalletError(STATUS_UNKNOWN);
  }
  const outcome = await resolveSigned(provider, marker);
  if (outcome === "unknown") {
    throw new WalletError(STATUS_UNKNOWN);
  }
  const next = settledRecord(outcome, marker.transactionHash);
  await replaceStuck(store, scope, marker.transactionHash, next);
  return next;
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
   */
  readonly submitAccepted: <P, T extends { readonly transactionHash: string }>(
    provider: RpcProvider,
    scope: Strk20MaturityScope,
    prepare: () => Promise<P>,
    broadcast: (prepared: P, journal: Strk20SubmissionJournal) => Promise<T>,
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
    // still the scope's marker; a newer send's marker must survive it.
    await store.replaceIfCurrentHash(scope, transactionHash, {
      acceptedBlock: block,
      state: "submitted",
      transactionHash,
    });
    return block;
  };

  const priorAcceptedBlock = async (
    provider: RpcProvider,
    scope: Strk20MaturityScope,
  ): Promise<number | undefined> => {
    const stored = await store.read(scope);
    const record =
      stored?.state === "submitting"
        ? await settleSubmitting(store, provider, scope, stored)
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
      if (error instanceof RejectedPrivacyTransaction) {
        await store.replaceIfCurrentHash(scope, record.transactionHash, null);
      }
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
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
    prepare: () => Promise<P>,
    broadcast: (prepared: P, journal: Strk20SubmissionJournal) => Promise<T>,
  ): Promise<T> =>
    serializeSubmission(scope, async () => {
      const prepared = await prepare();
      const previous = await store.read(scope);
      await store.write(scope, { state: "submitting" });
      const journal = journalFor(store, scope);
      // A structured RPC rejection is determinate: the sequencer refused the
      // transaction, so no write is in flight and the scope must be released or
      // every later attempt on it fails with a stale `submitting` guard.
      // Transport and unknown failures stay indeterminate — the transaction may
      // have been accepted after the response was lost — so those keep the scope
      // closed rather than risk proving against state a landed write invalidates.
      const result = await broadcast(prepared, journal).catch(async (error: unknown) => {
        if (!(error instanceof IndeterminateRpcWriteError) && !isTransportRpcError(error)) {
          await store.write(scope, previous);
        }
        throw error;
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
