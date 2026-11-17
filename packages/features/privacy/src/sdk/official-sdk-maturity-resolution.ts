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
 * receipt wait like any submitted write. Everything else stays closed with
 * STRK20_PRIOR_WRITE_UNRESOLVED, which a later check can clear: a pending or
 * pre-confirmed write, a hash the node does not know while its nonce is
 * unspent (a signed V3 invoke has no expiry of its own, and the pool's proof
 * window is governance-set, so neither bounds when it can land), a write
 * whose receipt wait failed, and any failed or malformed read.
 *
 * A `relay` claim names no hash, because the relay builds the transaction. It
 * records instead the pool storage slots its `apply_actions` call writes once
 * (`relay-claim-slots.ts`). The pool reverts the whole call when any of those
 * slots is already non-zero, so once one reads non-zero in a block the node
 * reports ACCEPTED_ON_L1, read at that block's hash, the call can never apply,
 * whoever holds it. Depth alone is not enough: Starknet has reorganized more
 * than PROVING_BLOCK_DEPTH blocks (review of mc-wallet 668). The claim is then
 * replaced, durably, by a `released` floor at that block, so every later proof
 * targets a block past it. While no finalized block shows a slot set, it
 * stays closed with
 * STRK20_PRIOR_WRITE_UNRESOLVED. A relay claim with no slots (written by an
 * earlier build), or a claim with no recorded route, has nothing the chain can
 * be asked about; it refuses with STRK20_PRIOR_WRITE_STRANDED. Either refusal
 * can be ended only by a new check or by the user's informed "Unlock anyway"
 * (mc-wallet #668).
 */

import { WalletError } from "@bramble/core/errors";
import { isTransactionNotFoundError } from "@bramble/starknet/provider";
import { classifyTransactionStatus } from "@bramble/starknet/rpc";
import { canonicalFelt, isStarkFieldElement } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import {
  maturityRecordNamesHash,
  STRK20_PRIOR_WRITE_STRANDED,
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

/** A relay claim released at the L1-finalized block its slot was seen set in. */
export type ReleasedRelayFloor = Extract<Strk20MaturityRecord, { readonly state: "released" }>;

// Bounds the search for the latest L1-finalized block: enough for any chain
// height a block number can hold, so a node cannot keep it searching.
const MAX_FINALITY_PROBES = 64;

type FinalizedBlock = { readonly hash: string; readonly number: number };

// The block `number`, if the node reports it ACCEPTED_ON_L1 with a canonical
// hash; null otherwise. Untrusted answers: anything malformed is not final.
const finalizedAt = async (
  provider: RpcProvider,
  number: number,
): Promise<FinalizedBlock | null> => {
  const block: unknown = await provider.getBlockWithTxHashes(number);
  if (typeof block !== "object" || block === null) return null;
  const { block_hash: rawHash, block_number: rawNumber, status } = block as Record<string, unknown>;
  const hash = typeof rawHash === "string" ? canonicalFelt(rawHash) : null;
  return status === "ACCEPTED_ON_L1" && rawNumber === number && hash !== null
    ? { hash, number }
    : null;
};

// The latest block at or below `ceiling` the node reports ACCEPTED_ON_L1. L1
// finality is monotone in block number, so a bounded binary search finds it;
// null when none is, or the search runs out.
const latestFinalized = async (
  provider: RpcProvider,
  ceiling: number,
): Promise<FinalizedBlock | null> => {
  const top = await finalizedAt(provider, ceiling);
  if (top) return top;
  let low = 0;
  let high = ceiling - 1;
  let found: FinalizedBlock | null = null;
  for (let probe = 0; probe < MAX_FINALITY_PROBES && low <= high; probe += 1) {
    const middle = low + Math.floor((high - low) / 2);
    const block = await finalizedAt(provider, middle);
    if (block) {
      found = block;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return low > high ? found : null;
};

// The L1-finalized block number in which one of `slots` already reads
// non-zero at the pool, read at that block's hash so every read is of one
// branch; null while none does. Storage values are untrusted RPC answers:
// only a canonical field element counts, and any failed or malformed read
// throws, so the caller keeps the claim closed.
const spentSlotBlock = async (
  provider: RpcProvider,
  poolAddress: string,
  slots: readonly string[],
): Promise<number | null> => {
  const ceiling = (await provider.getBlockNumber()) - PROVING_BLOCK_DEPTH;
  if (!Number.isSafeInteger(ceiling) || ceiling < 0) {
    throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
  }
  const finalized = await latestFinalized(provider, ceiling);
  if (finalized === null) {
    return null;
  }
  for (const slot of slots) {
    const raw: unknown = await provider.getStorageAt(poolAddress, slot, finalized.hash);
    const value = typeof raw === "string" ? canonicalFelt(raw) : null;
    if (value === null || !isStarkFieldElement(value)) {
      throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
    }
    if (BigInt(value) !== 0n) {
      return finalized.number;
    }
  }
  return null;
};

/** A prior write being followed to its receipt. */
export type SubmittedRecord = Extract<Strk20MaturityRecord, { readonly state: "submitted" }>;

// After a conditional release the store refused, the scope may simply be
// clean already (another check released it first): proceed then, and refuse
// only while some marker is still there.
const clearedMeanwhile = async (
  store: Strk20MaturityStore,
  scope: Strk20MaturityScope,
): Promise<null> => {
  if ((await store.read(scope)) !== null) {
    throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
  }
  return null;
};

// Replaces a stuck marker only while the store still names it. The comparison
// is inside the store's mutation, not a read followed by a later write: a send
// that started meanwhile has written its own marker, which must survive. A
// scope another check already cleared proceeds (L3).
const replaceStuck = async (
  store: Strk20MaturityStore,
  scope: Strk20MaturityScope,
  transactionHash: string,
  next: SubmittedRecord | null,
): Promise<SubmittedRecord | null> =>
  (await store.replaceIfCurrentHash(scope, transactionHash, next))
    ? next
    : clearedMeanwhile(store, scope);

/**
 * Maps a failed receipt wait on the scope's prior write. A proven rejection
 * releases the marker. While the marker still names the write, any other
 * failure keeps the "may still be in progress" refusal a later check can
 * clear. A marker replaced during the wait keeps its own refusal; anything
 * else is the generic service error.
 */
export const priorWaitFailure = async (
  store: Strk20MaturityStore,
  scope: Strk20MaturityScope,
  transactionHash: string,
  error: unknown,
): Promise<never> => {
  if (error instanceof RejectedPrivacyTransaction) {
    await store.replaceIfCurrentHash(scope, transactionHash, null);
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  if (error instanceof WalletError && error.message === STRK20_PRIOR_WRITE_UNRESOLVED) {
    throw error;
  }
  if (!maturityRecordNamesHash(await store.read(scope), transactionHash)) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
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

// An unsigned marker. An `account` claim that no running send owns proves
// nothing left the wallet and is cleared through the store's conditional
// release, which leaves a marker a send journaled meanwhile in place. A claim
// a live send may still sign or relay stays closed. A `relay` claim with
// recorded slots is released only once the chain shows one of them set (see
// the module header). Any other unsigned claim (a relay claim with no slots,
// or one with no recorded route) has nothing the chain can be asked about:
// the relay may hold or have sent its proof, and the pool's proof window
// cannot bound it, because the governor can change that window after the
// write applied (review round 2). It is stranded.
const releaseUnsigned = async (
  store: Strk20MaturityStore,
  provider: RpcProvider,
  scope: Strk20MaturityScope,
  marker: SubmittingRecord,
  ownedByLiveSend: boolean,
): Promise<ReleasedRelayFloor | null> => {
  if (ownedByLiveSend) {
    throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
  }
  if (marker.route === "relay" && marker.writeOnceSlots !== undefined) {
    let block: number | null;
    try {
      block = await spentSlotBlock(provider, scope.poolAddress, marker.writeOnceSlots);
    } catch {
      throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
    }
    if (block === null) {
      throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
    }
    return (await store.releaseRelayClaim(scope, marker.writeOnceSlots, block))
      ? { acceptedBlock: block, state: "released" }
      : clearedMeanwhile(store, scope);
  }
  if (marker.route !== "account") {
    throw new WalletError(STRK20_PRIOR_WRITE_STRANDED);
  }
  return (await store.releaseUnsigned(scope)) ? null : clearedMeanwhile(store, scope);
};

/**
 * Settles a `submitting` marker: the submitted write to follow, null once the
 * write provably cannot land, a {@link ReleasedRelayFloor} once a relay claim's
 * call provably cannot apply, or a refusal while it stays closed
 * (STRK20_PRIOR_WRITE_UNRESOLVED, or STRK20_PRIOR_WRITE_STRANDED when no later
 * check can resolve it). The full release rule is in this module's header.
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
): Promise<SubmittedRecord | ReleasedRelayFloor | null> => {
  if (marker.transactionHash === undefined) {
    return releaseUnsigned(store, provider, scope, marker, ownedByLiveSend);
  }
  const outcome = await resolveSigned(provider, marker);
  // Unknown stays checkable: the write may still settle, or another
  // transaction may spend its nonce. Nothing else bounds it: the pool's proof
  // window is governance-set and can change between the reads that would
  // compare against it (review round 2).
  if (outcome === "unknown") {
    throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
  }
  if (outcome === "inFlight") {
    return { state: "submitted", transactionHash: marker.transactionHash };
  }
  return replaceStuck(
    store,
    scope,
    marker.transactionHash,
    settledRecord(outcome, marker.transactionHash),
  );
};
