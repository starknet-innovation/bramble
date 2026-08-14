/** Pure display and import helpers for public Argent multisig state. */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import type { ArgentMultisigRecord } from "@mc-wallet/multisig/repository";
import { isArgentMultisigSigningIntent } from "@mc-wallet/multisig/repository";
import { canonicalFelt, isNonZeroStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import type { ArgentMultisigIntentPackage } from "../../../popup/responses/multisig-responses";
import { accountLabel } from "../../shared/parts";

/**
 * Resolves the user-facing name shared by Argent multisig surfaces.
 */
export const multisigDisplayName = (record: ArgentMultisigRecord): string =>
  record.name ?? accountLabel(record.address);

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
