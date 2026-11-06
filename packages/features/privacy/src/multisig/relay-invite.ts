/**
 * A typed-data request for a multisig relay. The proof stays on the device
 * that built it. Co-owners sign only the message hash, which must be the hash
 * of this typed data. A stored label is not a signed fact.
 */

import { hasOnlyKnownKeys, isJson, isRecord } from "@bramble/core/json";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { verifyStarkSignature } from "@bramble/starknet/signature-verify";
import { isAccountId } from "@bramble/wallet-model/accounts";
import { canonicalFelt, isStarkFieldElement, sameFelt } from "@bramble/wallet-model/networks";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import { type TypedData, typedData } from "starknet";

/**
 * What a co-owner needs to sign a relay, without the proof bytes.
 */
export type MultisigStrk20RelayInvite = {
  readonly accountAddress: string;
  readonly accountId: string;
  readonly fragments: readonly StarkSignature[];
  readonly id: string;
  readonly messageHash: string;
  readonly signerPublicKeys: readonly string[];
  readonly summary: string;
  readonly threshold: number;
  readonly typedData: TypedData;
};

const INVITE_KEYS = [
  "accountAddress",
  "accountId",
  "fragments",
  "id",
  "messageHash",
  "signerPublicKeys",
  "summary",
  "threshold",
  "typedData",
] as const;

const isFelt = (value: unknown): value is string =>
  typeof value === "string" && isStarkFieldElement(value) && canonicalFelt(value) === value;

const isFragment = (value: unknown): value is StarkSignature =>
  isRecord(value) &&
  typeof value["publicKey"] === "string" &&
  typeof value["r"] === "string" &&
  typeof value["s"] === "string" &&
  isFelt(value["publicKey"]) &&
  isFelt(value["r"]) &&
  isFelt(value["s"]);

const messageMatches = (record: {
  readonly accountAddress: string;
  readonly messageHash: string;
  readonly typedData: TypedData;
}): boolean => {
  try {
    const hash = canonicalFelt(typedData.getMessageHash(record.typedData, record.accountAddress));
    return hash !== null && sameFelt(hash, record.messageHash);
  } catch {
    return false;
  }
};

const fragmentsFit = (
  fragments: readonly StarkSignature[],
  signers: readonly string[],
  hash: string,
  threshold: number,
): boolean => {
  if (fragments.length > threshold) return false;
  const members = new Set(signers);
  // Strictly increasing signer GUIDs, as in a CallSet record: a repeated
  // signer cannot fill a slot another co-owner still has to sign.
  let prior = 0n;
  for (const fragment of fragments) {
    const guid = BigInt(argentSignerGuid(fragment.publicKey));
    if (
      !members.has(fragment.publicKey) ||
      guid <= prior ||
      !verifyStarkSignature({
        hash,
        publicKeyX: fragment.publicKey,
        signature: { r: fragment.r, s: fragment.s },
      })
    ) {
      return false;
    }
    prior = guid;
  }
  return true;
};

/**
 * True when the invite's typed data hashes to `messageHash` and every
 * fragment verifies against that hash. Extra fields, including proof bytes,
 * are refused. A mismatched label is ignored: the hash is the signed fact.
 */
export const isMultisigStrk20RelayInvite = (value: unknown): value is MultisigStrk20RelayInvite => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, INVITE_KEYS) ||
    !isAccountId(value["accountId"]) ||
    !isFelt(value["accountAddress"]) ||
    !isFelt(value["messageHash"]) ||
    typeof value["summary"] !== "string" ||
    value["summary"].length === 0 ||
    value["summary"].length > 280 ||
    !Array.isArray(value["signerPublicKeys"]) ||
    !value["signerPublicKeys"].every(isFelt) ||
    new Set(value["signerPublicKeys"]).size !== value["signerPublicKeys"].length ||
    typeof value["threshold"] !== "number" ||
    !Number.isSafeInteger(value["threshold"]) ||
    value["threshold"] < 1 ||
    value["threshold"] > value["signerPublicKeys"].length ||
    value["id"] !== `${value["accountId"]}:${value["messageHash"]}` ||
    !isJson(value["typedData"]) ||
    !isRecord(value["typedData"]) ||
    !Array.isArray(value["fragments"]) ||
    !value["fragments"].every(isFragment)
  ) {
    return false;
  }
  const record = value as MultisigStrk20RelayInvite;
  return (
    messageMatches(record) &&
    fragmentsFit(record.fragments, record.signerPublicKeys, record.messageHash, record.threshold)
  );
};

/**
 * The invite a co-owner can wrap. Proof bytes, the relay call, and the fee
 * action are omitted. Returns null when the relay has no typed-data digest
 * or the invite would not verify.
 */
export const multisigStrk20RelayInviteFrom = (relay: {
  readonly accountAddress: string;
  readonly accountId: string;
  readonly fragments: readonly StarkSignature[];
  readonly id: string;
  readonly messageHash?: string;
  readonly signerPublicKeys: readonly string[];
  readonly summary: string;
  readonly threshold: number;
  readonly typedData?: unknown;
}): MultisigStrk20RelayInvite | null => {
  if (!relay.messageHash || !isRecord(relay.typedData)) return null;
  const invite = {
    accountAddress: relay.accountAddress,
    accountId: relay.accountId,
    fragments: relay.fragments,
    id: relay.id,
    messageHash: relay.messageHash,
    signerPublicKeys: relay.signerPublicKeys,
    summary: relay.summary,
    threshold: relay.threshold,
    typedData: relay.typedData,
  };
  return isMultisigStrk20RelayInvite(invite) ? invite : null;
};

/**
 * Adds one verified relay fragment. Returns null when the signer is already
 * present, is not a member, or the fragment does not verify.
 */
export const withMultisigStrk20RelayInviteFragment = (
  record: MultisigStrk20RelayInvite,
  fragment: StarkSignature,
): MultisigStrk20RelayInvite | null => {
  if (
    record.fragments.length >= record.threshold ||
    record.fragments.some((existing) => existing.publicKey === fragment.publicKey) ||
    !record.signerPublicKeys.includes(fragment.publicKey) ||
    !verifyStarkSignature({
      hash: record.messageHash,
      publicKeyX: fragment.publicKey,
      signature: { r: fragment.r, s: fragment.s },
    })
  ) {
    return null;
  }
  const fragments = [...record.fragments, fragment].sort((left, right) =>
    BigInt(argentSignerGuid(left.publicKey)) < BigInt(argentSignerGuid(right.publicKey)) ? -1 : 1,
  );
  return { ...record, fragments };
};
