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
 * - any marker that names its proof's base block N, is not owned by a live
 *   send, and whose window has closed: the pool applies a proof only in a
 *   block at most `get_proof_validity_blocks()` (V) past its base
 *   (`PROOF_EXPIRED`), so once the settled block (tip minus
 *   PROVING_BLOCK_DEPTH) is past N + V, the write either never applied or
 *   applied in a block the next proof's state already contains. This holds
 *   for relay claims and for a signed write whose nonce is still unspent,
 *   neither of which anything else can prove. It assumes the pool's governor
 *   does not raise V afterwards.
 * A write the node reports accepted or reverted is settled through the
 * receipt wait like any submitted write. Everything else stays closed: a
 * pending or pre-confirmed write, a hash the node does not know while its
 * nonce is unspent and its proof window is open (a signed V3 invoke has no
 * expiry of its own), a relay claim inside its proof window, and any failed
 * or malformed read. Those refuse with STRK20_PRIOR_WRITE_UNRESOLVED, which a
 * later check can clear. A marker with no proof base block (a claim from
 * before blocks were recorded, or a proof whose facts could not be read)
 * that nothing else resolves refuses with STRK20_PRIOR_WRITE_STRANDED, which
 * names the only remaining way out: ending the browser session.
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

// True once a write proved at `proofBaseBlock` can no longer be applied by the
// pool in any block past the settled one (see the module header). Any failed
// or malformed read answers false.
const proofWindowClosed = async (
  provider: RpcProvider,
  scope: Strk20MaturityScope,
  proofBaseBlock: number | undefined,
): Promise<boolean> => {
  if (proofBaseBlock === undefined) {
    return false;
  }
  try {
    const settled = (await provider.getBlockNumber()) - PROVING_BLOCK_DEPTH;
    const validity = await proofValidityBlocks(provider, scope);
    return (
      Number.isSafeInteger(settled) &&
      validity !== null &&
      BigInt(settled) > BigInt(proofBaseBlock) + validity
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
 * releases the marker. While the marker still names the write, a write whose
 * proof window has closed is released (undefined: no floor), and any other
 * failure keeps the "may still be in progress" refusal a later check can
 * clear. A marker replaced during the wait keeps its own refusal; anything
 * else is the generic service error.
 */
export const priorWaitFailure = async (
  store: Strk20MaturityStore,
  provider: RpcProvider,
  scope: Strk20MaturityScope,
  record: SubmittedRecord,
  error: unknown,
): Promise<undefined> => {
  const { transactionHash } = record;
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
  if (await proofWindowClosed(provider, scope, record.proofBaseBlock)) {
    if (await store.replaceIfCurrentHash(scope, transactionHash, null)) {
      return undefined;
    }
    return (await clearedMeanwhile(store, scope)) ?? undefined;
  }
  throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
};

const settledRecord = (
  outcome: Exclude<SignedOutcome, "inFlight" | "unknown" | "unproven">,
  transactionHash: string,
  proofBaseBlock: number | undefined,
): SubmittedRecord | null => {
  switch (outcome) {
    case "landed":
      return {
        ...(proofBaseBlock === undefined ? {} : { proofBaseBlock }),
        state: "submitted",
        transactionHash,
      };
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
// nothing left the wallet; any other claim no running send owns is released
// once its proof window has closed. Both clear through the store's
// conditional release, which leaves a marker a send journaled meanwhile in
// place. A claim a live send may still sign stays closed, and a claim with no
// proof base block that nothing else resolves is stranded.
const releaseUnsigned = async (
  store: Strk20MaturityStore,
  provider: RpcProvider,
  scope: Strk20MaturityScope,
  marker: SubmittingRecord,
  ownedByLiveSend: boolean,
): Promise<null> => {
  if (ownedByLiveSend) {
    throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
  }
  if (marker.route === "account") {
    return (await store.releaseUnsigned(scope)) ? null : clearedMeanwhile(store, scope);
  }
  const { proofBaseBlock } = marker;
  if (proofBaseBlock === undefined) {
    throw new WalletError(STRK20_PRIOR_WRITE_STRANDED);
  }
  if (!(await proofWindowClosed(provider, scope, proofBaseBlock))) {
    throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
  }
  return (await store.releaseUnsignedProvedAt(scope, proofBaseBlock))
    ? null
    : clearedMeanwhile(store, scope);
};

// A signed write the chain could not settle. It is released once its proof
// window has closed. Until then a failed read can be retried; an unspent nonce
// with no proof base block never resolves on its own, so it is stranded.
const releaseUnsettled = async (
  store: Strk20MaturityStore,
  provider: RpcProvider,
  scope: Strk20MaturityScope,
  marker: SubmittingRecord & { readonly transactionHash: string },
  outcome: "unknown" | "unproven",
): Promise<null> => {
  if (await proofWindowClosed(provider, scope, marker.proofBaseBlock)) {
    return (await store.replaceIfCurrentHash(scope, marker.transactionHash, null))
      ? null
      : clearedMeanwhile(store, scope);
  }
  throw new WalletError(
    outcome === "unproven" && marker.proofBaseBlock === undefined
      ? STRK20_PRIOR_WRITE_STRANDED
      : STRK20_PRIOR_WRITE_UNRESOLVED,
  );
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
    return releaseUnsigned(store, provider, scope, marker, ownedByLiveSend);
  }
  const outcome = await resolveSigned(provider, marker);
  if (outcome === "unknown" || outcome === "unproven") {
    return releaseUnsettled(store, provider, scope, marker, outcome);
  }
  if (outcome === "inFlight") {
    return {
      ...(marker.proofBaseBlock === undefined ? {} : { proofBaseBlock: marker.proofBaseBlock }),
      state: "submitted",
      transactionHash: marker.transactionHash,
    };
  }
  const next = settledRecord(outcome, marker.transactionHash, marker.proofBaseBlock);
  await replaceStuck(store, scope, marker.transactionHash, next);
  return next;
};
