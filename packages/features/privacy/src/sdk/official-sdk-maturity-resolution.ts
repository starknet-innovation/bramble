/**
 * Resolution of a privacy write whose send lost its answer. The scope's
 * `submitting` marker keeps every later proof closed until the chain, or the
 * marker itself, proves what happened to that write. This module holds the
 * exact release rule; the runtime in `official-sdk-maturity.ts` decides when
 * it runs.
 *
 * The rule, in full. A marker is released (the scope reopens) only when the
 * write provably cannot change pool state:
 * - an `account` claim that names no signed write and is not owned by a send
 *   still running in this worker: the account route journals the signed
 *   identity before the signed transaction is released, so no signed write left the signing path;
 * - a signed write the node REJECTED: that hash will never be included;
 * - a signed write the node does not know, whose sender nonce is already
 *   spent past it in a block PROVING_BLOCK_DEPTH deep, and which a second
 *   lookup after that still misses: a nonce is spent once, so it cannot land.
 * A write the node reports accepted or reverted is settled through the
 * receipt wait like any submitted write. Everything else stays closed: a
 * pending or pre-confirmed write, a hash the node does not know while its
 * nonce is unspent (a signed V3 invoke has no expiry, so whoever holds it can
 * still have it included at that nonce), a relay claim with no hash, a claim
 * with no recorded route, and any failed or malformed read.
 */

import { WalletError } from "@bramble/core/errors";
import { isTransactionNotFoundError } from "@bramble/starknet/provider";
import { classifyTransactionStatus } from "@bramble/starknet/rpc";
import { canonicalFelt, isStarkFieldElement } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import {
  STRK20_PRIOR_WRITE_UNRESOLVED,
  type Strk20MaturityRecord,
  type Strk20MaturityScope,
  type Strk20MaturityStore,
  type Strk20SignedSubmission,
} from "../policy/maturity";
import { STRK20_SERVICE_UNAVAILABLE } from "../service";

/** Depth below the tip at which a proof targets state, and a nonce counts as spent. */
export const PROVING_BLOCK_DEPTH = 10;

/** A prior write whose receipt shows it reverted on chain. */
export class RejectedPrivacyTransaction extends Error {}

// `inFlight` is a pending or pre-confirmed write: it reached the network but
// can still vanish, so its signed identity must outlive the lookup.
type SignedOutcome = "dropped" | "inFlight" | "landed" | "rejected" | "unknown";

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
        case "reverted":
          return "landed";
        case "pending":
        case "preconfirmed":
          return "inFlight";
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

/** A prior write being followed to its receipt. */
export type SubmittedRecord = Extract<Strk20MaturityRecord, { readonly state: "submitted" }>;

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
    throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
  }
};

/**
 * Maps a failed receipt wait on the scope's prior write. A proven rejection
 * releases the marker; a marker replaced during the wait keeps its own
 * status-unknown refusal; anything else is the generic service error.
 */
export const priorWaitFailure = async (
  store: Strk20MaturityStore,
  scope: Strk20MaturityScope,
  transactionHash: string,
  error: unknown,
): Promise<never> => {
  if (error instanceof RejectedPrivacyTransaction) {
    await store.replaceIfCurrentHash(scope, transactionHash, null);
  }
  if (error instanceof WalletError && error.message === STRK20_PRIOR_WRITE_UNRESOLVED) {
    throw error;
  }
  throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
};

const settledRecord = (
  outcome: Exclude<SignedOutcome, "inFlight" | "unknown">,
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

// An unsigned marker. Only an `account` claim that no running send owns
// proves nothing left the wallet; it is cleared through the store's
// conditional release, which leaves a marker a send journaled meanwhile in
// place. A relay claim, a claim with no recorded route, and a claim a live
// send may still sign all stay closed.
const releaseUnsigned = async (
  store: Strk20MaturityStore,
  scope: Strk20MaturityScope,
  marker: SubmittingRecord,
  ownedByLiveSend: boolean,
): Promise<null> => {
  if (marker.route !== "account" || ownedByLiveSend || !(await store.releaseUnsigned(scope))) {
    throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
  }
  return null;
};

/**
 * Settles a `submitting` marker: the submitted write to follow, null once the
 * write provably cannot land, or STRK20_PRIOR_WRITE_UNRESOLVED while it stays closed. The
 * full release rule is in this module's header.
 *
 * `ownedByLiveSend` must be read synchronously right before the call, from the
 * runtime's record of sends between their claim and their settled broadcast.
 *
 * A pending or pre-confirmed write is followed without rewriting its marker.
 * It can still vanish, and only the signed marker carries the sender and nonce
 * the spent-nonce proof needs; the receipt wait replaces the marker once the
 * write is accepted, so a write that vanishes first leaves the marker for the
 * next action to resolve (mc-wallet 474 item 2).
 */
export const settleSubmitting = async (
  store: Strk20MaturityStore,
  provider: RpcProvider,
  scope: Strk20MaturityScope,
  marker: SubmittingRecord,
  ownedByLiveSend: boolean,
): Promise<SubmittedRecord | null> => {
  if (marker.transactionHash === undefined) {
    return releaseUnsigned(store, scope, marker, ownedByLiveSend);
  }
  const outcome = await resolveSigned(provider, marker);
  if (outcome === "unknown") {
    throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
  }
  if (outcome === "inFlight") {
    return { state: "submitted", transactionHash: marker.transactionHash };
  }
  const next = settledRecord(outcome, marker.transactionHash);
  await replaceStuck(store, scope, marker.transactionHash, next);
  return next;
};
