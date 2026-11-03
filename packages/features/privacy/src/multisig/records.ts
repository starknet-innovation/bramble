/**
 * Local records for an Argent multisig's STRK20 rounds. Round one is the
 * pool CallSet digest. Round two is either the frozen account transaction
 * (its proof bytes live beside that intent) or the relayer request. The
 * shared scalar is never a field here: calldata is stored redacted.
 */

import { hasOnlyKnownKeys, isJson, isRecord } from "@bramble/core/json";
import {
  type ArgentMultisigConfig,
  argentSignerGuid,
  serializeArgentMultisigSignature,
} from "@bramble/starknet/account-contracts";
import { verifyStarkSignature } from "@bramble/starknet/signature-verify";
import { isAccountId } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import { isStrk20Proof, STRK20_LIMITS, type Strk20Proof } from "@bramble/wallet-protocol/strk20";
import { type Call, num } from "starknet";
import { computeStrk20CallSetHash } from "../policy/call-set-signer";
import { restoreStrk20Calldata } from "./redaction";

/** How many CallSet authorizations one wallet keeps. */
export const MAX_MULTISIG_STRK20_AUTHORIZATIONS = 25;

/** How many local proofs and relay requests one wallet keeps. Proof bytes are large. */
export const MAX_MULTISIG_STRK20_PROOFS = 8;

/** Nostr application id for a CallSet authorization or a relay request. Not an intent. */
export const MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER = "bramble.multisig.strk20-authorization";

const SUMMARY_LIMIT = 280;
const CALLDATA_LIMIT = 256;

/**
 * What the multisig asked the pool to do, so a later refresh can prove it again.
 */
export type MultisigStrk20ActionRequest = {
  readonly amount?: string;
  readonly kind: "deposit" | "register" | "transfer" | "withdraw";
  readonly recipient?: string;
  readonly token?: string;
};

/**
 * One pool call with the shared scalar removed from its calldata.
 */
export type MultisigStrk20RedactedCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

/**
 * Threshold collection for the pool's CallSet digest. `hash` is that digest.
 * Co-owners recompute it from the redacted calls and their own copy of the scalar.
 */
export type MultisigStrk20Authorization = {
  readonly accountAddress: string;
  readonly accountId: string;
  readonly calls: readonly MultisigStrk20RedactedCall[];
  readonly chainId: string;
  readonly fragments: readonly StarkSignature[];
  readonly hash: string;
  readonly id: string;
  readonly request: MultisigStrk20ActionRequest;
  readonly signerPublicKeys: readonly string[];
  readonly state: "collecting" | "ready";
  readonly summary: string;
  readonly threshold: number;
};

/**
 * Proof bytes for one frozen account intent. They are not part of the intent
 * package, because a proof does not fit a Nostr gift wrap and is not in the hash.
 */
export type MultisigStrk20ProofRecord = {
  readonly intentId: string;
  readonly proof: Strk20Proof;
  readonly request: MultisigStrk20ActionRequest;
};

/**
 * Frozen relayer request. `messageHash` is absent when the relay needs no
 * account aggregate beyond the CallSet already inside the proof. The proof
 * stays on this device.
 */
export type MultisigStrk20RelayRequest = {
  readonly accountAddress: string;
  readonly accountId: string;
  readonly authorization?: {
    readonly caller: string;
    readonly executeAfter: string;
    readonly executeBefore: string;
    readonly publicCallCount: number;
  };
  readonly call: MultisigStrk20RedactedCall;
  readonly feeAction: {
    readonly amount: string;
    readonly recipient: string;
    readonly token: string;
    readonly type: "withdraw";
  };
  readonly fragments: readonly StarkSignature[];
  readonly id: string;
  readonly messageHash?: string;
  readonly proof: Strk20Proof;
  readonly request: MultisigStrk20ActionRequest;
  readonly signerPublicKeys: readonly string[];
  readonly state: "collecting" | "ready" | "submitted";
  readonly summary: string;
  readonly threshold: number;
  readonly typedData?: unknown;
};

const isFelt = (value: unknown): value is string =>
  typeof value === "string" && isStarkFieldElement(value) && canonicalFelt(value) === value;

const isEntry = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value;

const isSummary = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= SUMMARY_LIMIT &&
  value.trim() === value;

const isRequest = (value: unknown): value is MultisigStrk20ActionRequest => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, ["amount", "kind", "recipient", "token"])) {
    return false;
  }
  const kind = value["kind"];
  if (kind !== "deposit" && kind !== "register" && kind !== "transfer" && kind !== "withdraw") {
    return false;
  }
  const amount = value["amount"];
  const recipient = value["recipient"];
  const token = value["token"];
  if (kind === "register")
    return amount === undefined && recipient === undefined && token === undefined;
  if (typeof amount !== "string" || amount.length === 0 || amount.length > 80 || !isFelt(token)) {
    return false;
  }
  if (kind === "deposit") return recipient === undefined || isFelt(recipient);
  return isFelt(recipient);
};

const isCall = (value: unknown): value is MultisigStrk20RedactedCall =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["calldata", "contractAddress", "entrypoint"]) &&
  isFelt(value["contractAddress"]) &&
  isNonZeroStarkFieldElement(value["contractAddress"]) &&
  isEntry(value["entrypoint"]) &&
  Array.isArray(value["calldata"]) &&
  value["calldata"].length <= CALLDATA_LIMIT &&
  value["calldata"].every(isFelt);

const isFragment = (value: unknown): value is StarkSignature =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["publicKey", "r", "s"]) &&
  isFelt(value["publicKey"]) &&
  isNonZeroStarkFieldElement(value["publicKey"]) &&
  isFelt(value["r"]) &&
  isFelt(value["s"]);

const sortedFragments = (values: readonly StarkSignature[]): readonly StarkSignature[] =>
  [...values].sort((left, right) =>
    BigInt(argentSignerGuid(left.publicKey)) < BigInt(argentSignerGuid(right.publicKey)) ? -1 : 1,
  );

const fragmentsFit = (
  fragments: readonly StarkSignature[],
  signerPublicKeys: readonly string[],
  hash: string,
  threshold: number,
): boolean => {
  if (fragments.length > threshold) return false;
  const members = new Set(signerPublicKeys);
  let prior = 0n;
  for (const fragment of fragments) {
    const guid = argentSignerGuid(fragment.publicKey);
    if (
      !members.has(fragment.publicKey) ||
      BigInt(guid) <= prior ||
      !verifyStarkSignature({
        hash,
        publicKeyX: fragment.publicKey,
        signature: { r: fragment.r, s: fragment.s },
      })
    ) {
      return false;
    }
    prior = BigInt(guid);
  }
  return true;
};

const isSignerSet = (value: unknown, threshold: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 32 &&
  value.every(isFelt) &&
  new Set(value).size === value.length &&
  typeof threshold === "number" &&
  Number.isSafeInteger(threshold) &&
  threshold >= 1 &&
  threshold <= value.length;

/**
 * Recomputes the pool CallSet digest from redacted calls and this wallet's scalar.
 * Returns null when the calls were not redacted for that scalar.
 */
export const multisigStrk20CallSetHash = (
  accountAddress: string,
  calls: readonly MultisigStrk20RedactedCall[],
  chainId: string,
  scalar: string,
): string | null => {
  const restored = calls.map((call) => {
    const calldata = restoreStrk20Calldata(call.calldata, scalar);
    return calldata ? { ...call, calldata } : null;
  });
  if (restored.some((call) => call === null)) return null;
  return num.toHex(computeStrk20CallSetHash(accountAddress, restored as Call[], chainId));
};

/**
 * True when the record's digest matches the redacted calls and every fragment
 * verifies against it. `scalar` never leaves this check.
 */
export const isMultisigStrk20Authorization = (
  value: unknown,
  scalar: string,
): value is MultisigStrk20Authorization => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "accountAddress",
      "accountId",
      "calls",
      "chainId",
      "fragments",
      "hash",
      "id",
      "request",
      "signerPublicKeys",
      "state",
      "summary",
      "threshold",
    ]) ||
    !isAccountId(value["accountId"]) ||
    !isFelt(value["accountAddress"]) ||
    !isFelt(value["chainId"]) ||
    !isFelt(value["hash"]) ||
    !isSummary(value["summary"]) ||
    !isRequest(value["request"]) ||
    !isSignerSet(value["signerPublicKeys"], value["threshold"]) ||
    !Array.isArray(value["calls"]) ||
    value["calls"].length === 0 ||
    value["calls"].length > 16 ||
    !value["calls"].every(isCall) ||
    !Array.isArray(value["fragments"]) ||
    !value["fragments"].every(isFragment) ||
    (value["state"] !== "collecting" && value["state"] !== "ready")
  ) {
    return false;
  }
  const record = value as MultisigStrk20Authorization;
  const digest = multisigStrk20CallSetHash(
    record.accountAddress,
    record.calls,
    record.chainId,
    scalar,
  );
  if (
    digest === null ||
    !sameFelt(digest, record.hash) ||
    record.id !== `${record.accountId}:${record.hash}` ||
    !fragmentsFit(record.fragments, record.signerPublicKeys, record.hash, record.threshold)
  ) {
    return false;
  }
  return record.state === "ready"
    ? record.fragments.length === record.threshold
    : record.fragments.length < record.threshold;
};

/**
 * The Argent multisig aggregate the pool's `is_valid_signature` expects.
 * starknet.js hex-normalizes each felt before the prover sees it; the felt
 * values are unchanged.
 */
export const multisigStrk20CallSetAggregate = (
  fragments: readonly StarkSignature[],
  config: ArgentMultisigConfig,
): readonly string[] => serializeArgentMultisigSignature(sortedFragments(fragments), config);

/**
 * Adds one verified fragment. Returns null when the signer is already present,
 * is not a member, or the fragment does not verify.
 */
export const withMultisigStrk20Fragment = (
  record: MultisigStrk20Authorization,
  fragment: StarkSignature,
): MultisigStrk20Authorization | null => {
  if (
    record.state !== "collecting" ||
    record.fragments.some((existing) => existing.publicKey === fragment.publicKey) ||
    !record.signerPublicKeys.includes(fragment.publicKey) ||
    !verifyStarkSignature({
      hash: record.hash,
      publicKeyX: fragment.publicKey,
      signature: { r: fragment.r, s: fragment.s },
    })
  ) {
    return null;
  }
  const fragments = sortedFragments([...record.fragments, fragment]);
  const next: MultisigStrk20Authorization = {
    ...record,
    fragments,
    state: fragments.length === record.threshold ? "ready" : "collecting",
  };
  return next;
};

/**
 * True for a local proof bound to an intent id. The facts are the ones frozen
 * into that intent's hash; this check only bounds the bytes.
 */
export const isMultisigStrk20ProofRecord = (value: unknown): value is MultisigStrk20ProofRecord =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["intentId", "proof", "request"]) &&
  typeof value["intentId"] === "string" &&
  value["intentId"].length > 0 &&
  value["intentId"].length <= 256 &&
  isRequest(value["request"]) &&
  isStrk20Proof(value["proof"]) &&
  value["proof"].data.length > 0 &&
  value["proof"].proof_facts.length > 0 &&
  value["proof"].proof_facts.length <= STRK20_LIMITS.proofFacts &&
  value["proof"].proof_facts.every(isFelt);

const isAuthorizationReview = (
  value: unknown,
): value is NonNullable<MultisigStrk20RelayRequest["authorization"]> =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["caller", "executeAfter", "executeBefore", "publicCallCount"]) &&
  isFelt(value["caller"]) &&
  isFelt(value["executeAfter"]) &&
  isFelt(value["executeBefore"]) &&
  typeof value["publicCallCount"] === "number" &&
  Number.isSafeInteger(value["publicCallCount"]) &&
  value["publicCallCount"] >= 0 &&
  value["publicCallCount"] <= 32;

const isFeeAction = (value: unknown): value is MultisigStrk20RelayRequest["feeAction"] =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["amount", "recipient", "token", "type"]) &&
  value["type"] === "withdraw" &&
  isFelt(value["amount"]) &&
  isFelt(value["recipient"]) &&
  isFelt(value["token"]);

const RELAY_KEYS = [
  "accountAddress",
  "accountId",
  "authorization",
  "call",
  "feeAction",
  "fragments",
  "id",
  "messageHash",
  "proof",
  "request",
  "signerPublicKeys",
  "state",
  "summary",
  "threshold",
  "typedData",
] as const;

const relayShape = (value: Record<string, unknown>): boolean =>
  hasOnlyKnownKeys(value, RELAY_KEYS) &&
  isFeeAction(value["feeAction"]) &&
  (value["authorization"] === undefined || isAuthorizationReview(value["authorization"])) &&
  isAccountId(value["accountId"]) &&
  isFelt(value["accountAddress"]) &&
  isCall(value["call"]) &&
  isSummary(value["summary"]) &&
  isRequest(value["request"]) &&
  isSignerSet(value["signerPublicKeys"], value["threshold"]) &&
  Array.isArray(value["fragments"]) &&
  value["fragments"].every(isFragment) &&
  isStrk20Proof(value["proof"]) &&
  value["proof"].data.length > 0 &&
  (value["state"] === "collecting" || value["state"] === "ready" || value["state"] === "submitted");

const relayAuthority = (record: MultisigStrk20RelayRequest): boolean => {
  const hash = record.messageHash;
  const fingerprint = hash ?? record.proof.proof_facts.at(-1);
  if (fingerprint === undefined || record.id !== `${record.accountId}:${fingerprint}`) return false;
  if (
    hash !== undefined &&
    !fragmentsFit(record.fragments, record.signerPublicKeys, hash, record.threshold)
  ) {
    return false;
  }
  if (hash === undefined) return record.fragments.length === 0 && record.state !== "collecting";
  return record.state === "collecting"
    ? record.fragments.length < record.threshold
    : record.fragments.length === record.threshold;
};

const isRelay = (value: unknown): value is MultisigStrk20RelayRequest => {
  if (!isRecord(value) || !relayShape(value)) return false;
  const hash = value["messageHash"];
  if (hash !== undefined && !isFelt(hash)) return false;
  if (value["typedData"] !== undefined && !isJson(value["typedData"])) return false;
  if ((hash === undefined) !== (value["typedData"] === undefined)) return false;
  if ((value["authorization"] === undefined) !== (value["typedData"] === undefined)) return false;
  return relayAuthority(value as MultisigStrk20RelayRequest);
};

/**
 * Strictly validates a stored relay request, including every fragment over its
 * typed-data digest. Does not recompute that digest; the caller does, from the
 * stored typed data, before trusting the record.
 */
export const isMultisigStrk20RelayRequest = (value: unknown): value is MultisigStrk20RelayRequest =>
  isRelay(value);
