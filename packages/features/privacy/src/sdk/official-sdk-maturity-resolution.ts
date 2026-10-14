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
 * - a signed write the node does not know, whose nonce is still unspent at
 *   the tip, that no running send owns, and whose proof the pool would refuse
 *   in every later block: its claim names the base block N its proof facts
 *   carry, and the pool applies a proof only while the block number is at
 *   most N + `get_proof_validity_blocks()` (V) (`PROOF_EXPIRED`). The
 *   unspent nonce at the tip proves no block so far included it, and a
 *   settled block (tip minus PROVING_BLOCK_DEPTH) past N + V proves no later
 *   block can, unless the pool's governor RAISES V or the pool is upgraded
 *   afterwards. That is the one stated assumption of this rule.
 * A write the node reports accepted or reverted is settled through the
 * receipt wait like any submitted write. Everything else stays closed with
 * STRK20_PRIOR_WRITE_UNRESOLVED, which a later check can clear: a pending or
 * pre-confirmed write, a signed write inside its proof window, a write whose
 * receipt wait failed, and any failed or malformed read. A relay claim (or a
 * claim with no recorded route) that names no hash has nothing the chain can
 * be asked about. The pool window cannot bound it: a governor that LOWERS V
 * after the relayed write applied would make it look expired while it sits
 * past the next proof's block. It refuses with STRK20_PRIOR_WRITE_STRANDED.
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
// can still vanish, so its signed identity must outlive the lookup. `unproven`
// is a hash the node does not know while the sender's nonce is unspent: the
// chain answered, and nothing it said proves the write dropped. `unknown` is a
// read that failed or could not be trusted, which a later check may get past.
type SignedOutcome = "dropped" | "inFlight" | "landed" | "rejected" | "unknown" | "unproven";

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

// `ProofFacts` serialize as proof_version, program_variant,
// virtual_program_hash, starknet_os_output_version, base_block_number, … (the
// pool's `ProofFacts` struct; the SDK's `utils/proof-facts.ts` index [4]).
const PROOF_FACTS_BASE_BLOCK = 4;

/**
 * The base block a proof's facts name, or null when they cannot be read as a
 * u64 safe integer. The pool enforces its proof window against these exact
 * facts, so the value read here is the one that bounds the write's inclusion.
 */
export const strk20ProofBaseBlock = (proofFacts: readonly string[]): number | null => {
  const value = chainNonce(proofFacts[PROOF_FACTS_BASE_BLOCK]);
  return value !== null && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
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
    if (spent === null) {
      return "unknown";
    }
    if (spent <= BigInt(signed.nonce)) {
      return "unproven";
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

// The pool's proof window, in blocks, as an untrusted u64 answer.
const proofValidityBlocks = async (
  provider: RpcProvider,
  scope: Strk20MaturityScope,
): Promise<bigint | null> => {
  const answer = await provider.callContract({
    calldata: [],
    contractAddress: scope.poolAddress,
    entrypoint: "get_proof_validity_blocks",
  });
  const value = chainNonce(Array.isArray(answer) ? answer[0] : undefined);
  return value !== null && value < 1n << 64n ? value : null;
};

// True only when a signed write provably never applied and never can: the
// sender's nonce read at the tip is still not past the write's nonce, so no
// block up to the tip included it, and the settled block (tip minus
// PROVING_BLOCK_DEPTH, a reorg margin) is already past base + validity, so
// the pool refuses its proof in every later block (`PROOF_EXPIRED`). Reading
// the nonce at the tip, rather than trusting the window alone, means a
// governor LOWERING the window cannot hide an inclusion the window once
// allowed. Any failed or malformed read answers false.
const signedWriteExpired = async (
  provider: RpcProvider,
  scope: Strk20MaturityScope,
  signed: Strk20SignedSubmission,
  proofBaseBlock: number | undefined,
): Promise<boolean> => {
  if (proofBaseBlock === undefined) {
    return false;
  }
  try {
    const tip = await provider.getBlockNumber();
    const validity = await proofValidityBlocks(provider, scope);
    const nonce = chainNonce(await provider.getNonceForAddress(signed.senderAddress, tip));
    return (
      Number.isSafeInteger(tip) &&
      validity !== null &&
      nonce !== null &&
      nonce <= BigInt(signed.nonce) &&
      BigInt(tip - PROVING_BLOCK_DEPTH) > BigInt(proofBaseBlock) + validity
    );
  } catch {
    return false;
  }
};

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
  outcome: Exclude<SignedOutcome, "inFlight" | "unknown" | "unproven">,
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
// a live send may still sign stays closed. Any other unsigned claim (a relay
// claim, or one with no recorded route) has nothing the chain can be asked
// about: the relay may hold or have sent its proof, and the pool's proof
// window cannot bound it, because the governor can change that window after
// the write applied (review round 2). It is stranded.
const releaseUnsigned = async (
  store: Strk20MaturityStore,
  scope: Strk20MaturityScope,
  marker: SubmittingRecord,
  ownedByLiveSend: boolean,
): Promise<null> => {
  if (ownedByLiveSend) {
    throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
  }
  if (marker.route !== "account") {
    throw new WalletError(STRK20_PRIOR_WRITE_STRANDED);
  }
  return (await store.releaseUnsigned(scope)) ? null : clearedMeanwhile(store, scope);
};

// A signed write the chain could not settle: the node does not know its hash
// while its nonce is unspent (`unproven`), or a read failed (`unknown`). An
// `unproven` write no running send owns is released once it provably never
// applied and never can (`signedWriteExpired`). Everything else stays
// checkable: the write may still settle, or another transaction may spend its
// nonce.
const releaseUnsettled = async (
  store: Strk20MaturityStore,
  provider: RpcProvider,
  scope: Strk20MaturityScope,
  marker: SubmittingRecord & Strk20SignedSubmission,
  outcome: "unknown" | "unproven",
  ownedByLiveSend: boolean,
): Promise<null> => {
  if (
    outcome === "unproven" &&
    !ownedByLiveSend &&
    (await signedWriteExpired(provider, scope, marker, marker.proofBaseBlock))
  ) {
    return (await store.replaceIfCurrentHash(scope, marker.transactionHash, null))
      ? null
      : clearedMeanwhile(store, scope);
  }
  throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
};

/**
 * Settles a `submitting` marker: the submitted write to follow, null once the
 * write provably cannot land, or a refusal while it stays closed
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
): Promise<SubmittedRecord | null> => {
  if (marker.transactionHash === undefined) {
    return releaseUnsigned(store, scope, marker, ownedByLiveSend);
  }
  const outcome = await resolveSigned(provider, marker);
  if (outcome === "unknown" || outcome === "unproven") {
    return releaseUnsettled(store, provider, scope, marker, outcome, ownedByLiveSend);
  }
  if (outcome === "inFlight") {
    return { state: "submitted", transactionHash: marker.transactionHash };
  }
  const next = settledRecord(outcome, marker.transactionHash);
  await replaceStuck(store, scope, marker.transactionHash, next);
  return next;
};
