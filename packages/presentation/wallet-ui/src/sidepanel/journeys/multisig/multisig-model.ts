/** Pure display and import helpers for public Argent multisig state. */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import { isArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { ArgentMultisigIntentPackage } from "../../../popup/responses/multisig-responses";
import { accountLabel } from "../../shared/parts";

/**
 * Resolves the user-facing name shared by Argent multisig surfaces.
 */
export const multisigDisplayName = (record: ArgentMultisigRecord): string =>
  record.name ?? accountLabel(record.address);

const sameAction = (
  left: ArgentMultisigSigningIntent,
  right: ArgentMultisigSigningIntent,
): boolean =>
  left.accountId === right.accountId &&
  sameFelt(left.configSnapshot.classHash, right.configSnapshot.classHash) &&
  left.configSnapshot.threshold === right.configSnapshot.threshold &&
  left.configSnapshot.signerGuids.length === right.configSnapshot.signerGuids.length &&
  left.configSnapshot.signerGuids.every((guid, index) =>
    sameFelt(guid, right.configSnapshot.signerGuids[index] ?? ""),
  ) &&
  sameFelt(left.prepared.nonce, right.prepared.nonce) &&
  left.prepared.calls.length === right.prepared.calls.length &&
  left.prepared.calls.every((call, index) => {
    const other = right.prepared.calls[index];
    return (
      other !== undefined &&
      call.entrypoint === other.entrypoint &&
      sameFelt(call.contractAddress, other.contractAddress) &&
      call.calldata.length === other.calldata.length &&
      call.calldata.every((value, valueIndex) => sameFelt(value, other.calldata[valueIndex] ?? ""))
    );
  });

/**
 * Returns the strongest fee-updated version already stored for one failed attempt.
 */
export const feeReplacementIntentFor = (
  stale: ArgentMultisigSigningIntent,
  intents: readonly ArgentMultisigSigningIntent[],
): ArgentMultisigSigningIntent | null => {
  if (stale.state !== "stale") return null;
  return intents.reduce<ArgentMultisigSigningIntent | null>(
    (best, candidate) =>
      candidate.id !== stale.id &&
      (candidate.state === "collecting" || candidate.state === "ready") &&
      sameAction(stale, candidate) &&
      (!best || candidate.signatures.length >= best.signatures.length)
        ? candidate
        : best,
    null,
  );
};

/**
 * Identifies an open fee-updated version of a retained failed attempt.
 */
export const isFeeReplacementIntent = (
  intent: ArgentMultisigSigningIntent,
  intents: readonly ArgentMultisigSigningIntent[],
): boolean =>
  (intent.state === "collecting" || intent.state === "ready") &&
  intents.some(
    (candidate) =>
      candidate.state === "stale" && candidate.id !== intent.id && sameAction(candidate, intent),
  );

const statePriority = (intent: ArgentMultisigSigningIntent): number =>
  intent.state === "ready" ? 2 : intent.state === "stale" ? 1 : 0;

/**
 * Collapses fee-bound hashes into one logical actionable transaction for display.
 */
export const actionableArgentMultisigIntents = (
  intents: readonly ArgentMultisigSigningIntent[],
): readonly ArgentMultisigSigningIntent[] => {
  const preferred: ArgentMultisigSigningIntent[] = [];
  // ponytail: the store is capped at 100 intents; index only if that cap grows.
  for (const intent of intents) {
    if (intent.state !== "collecting" && intent.state !== "ready" && intent.state !== "stale") {
      continue;
    }
    if (
      intents.some(
        (candidate) =>
          (candidate.state === "submitted" || candidate.state === "accepted") &&
          sameAction(candidate, intent),
      )
    ) {
      continue;
    }
    const index = preferred.findIndex((candidate) => sameAction(candidate, intent));
    if (index < 0) {
      preferred.push(intent);
      continue;
    }
    const current = preferred[index];
    if (
      current &&
      (intent.signatures.length > current.signatures.length ||
        (intent.signatures.length === current.signatures.length &&
          statePriority(intent) >= statePriority(current)))
    ) {
      preferred[index] = intent;
    }
  }
  return preferred;
};

/**
 * Serializes the deterministic full package independent co-signers exchange.
 */
export const serializeArgentMultisigIntentPackage = (value: ArgentMultisigIntentPackage): string =>
  JSON.stringify(value);

/**
 * Parses an untrusted full-intent package without normalizing signed fields.
 */
export const parseArgentMultisigIntentPackage = (
  raw: string,
): ArgentMultisigIntentPackage | null => {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) &&
      hasOnlyKnownKeys(value, ["intent", "kind", "version"]) &&
      value["kind"] === "mc-wallet.argent-multisig-intent" &&
      value["version"] === 1 &&
      isArgentMultisigSigningIntent(value["intent"])
      ? (value as ArgentMultisigIntentPackage)
      : null;
  } catch {
    return null;
  }
};

/**
 * Parses an untrusted canonical Stark-signature fragment or returns null.
 */
export const parseArgentMultisigSignature = (
  raw: string,
): { readonly publicKey: string; readonly r: string; readonly s: string } | null => {
  try {
    const value: unknown = JSON.parse(raw);
    const isCanonicalNonZeroFelt = (entry: unknown): entry is string =>
      typeof entry === "string" &&
      isNonZeroStarkFieldElement(entry) &&
      canonicalFelt(entry) === entry;
    return isRecord(value) &&
      hasOnlyKnownKeys(value, ["publicKey", "r", "s"]) &&
      isCanonicalNonZeroFelt(value["publicKey"]) &&
      isCanonicalNonZeroFelt(value["r"]) &&
      isCanonicalNonZeroFelt(value["s"])
      ? { publicKey: value["publicKey"], r: value["r"], s: value["s"] }
      : null;
  } catch {
    return null;
  }
};
