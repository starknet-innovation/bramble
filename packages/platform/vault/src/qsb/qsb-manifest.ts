/**
 * The portable QSB recovery manifest, `qsb-secret-manifest` version 1, from the
 * "QSB Wallet Secret Management" BIP ("Portable recovery manifest"). The
 * manifest is the journal half of a QSB backup: high-water mark and vault
 * records, never the phrase (or its optional extension), `K`, or any preimage. It is
 * privacy-sensitive wallet metadata, and nothing inside it is trusted.
 *
 * Export is built field by field from an account's bound journal, so no field
 * the format does not name can reach the file. Import parses strictly (duplicate
 * members, unknown members, invalid UTF-8, trailing data, and non-integral
 * numbers are refused) and validates every structural rule of the format,
 * including that each disclosure's transaction parses and spends its funding
 * outpoint exactly once.
 *
 * Shape only. The cryptographic re-checks the BIP requires before a record is
 * trusted — the root recomputed from the phrase, the script hash recomputed,
 * the script's commitments matched, the disclosure digest recomputed, and the
 * funding checked against the previous transaction — need hashing and Krusty,
 * and run later in the background. Until then, and whatever they find, every
 * imported record is `unknown` (or stays `retired`) and its account read-only.
 */
import { hasOnlyKnownKeys, isRecord, type JsonBudget } from "@bramble/core/json";
import {
  parseStrictJson,
  parseStrictJsonBytes,
  type StrictJsonRefusal,
} from "@bramble/core/strict-json";
import type { QsbJournalBinding } from "./qsb-journal-record";
import {
  isQsbHighWaterMark,
  isQsbJournalOrder,
  isQsbVaultRecord,
  MAX_QSB_VAULTS_PER_ACCOUNT,
  QSB_MAX_SCRIPT_BYTES,
  QSB_MAX_TRANSACTION_BYTES,
  QSB_NETWORK,
  QSB_PROFILE,
  type QsbDisclosure,
  type QsbVaultRecord,
  type QsbVaultState,
} from "./qsb-vault-record";

/** The manifest `format` tag. */
export const QSB_MANIFEST_FORMAT = "qsb-secret-manifest";

/** The only manifest `version` this codec reads and writes. */
export const QSB_MANIFEST_VERSION = 1;

/** A funding record as the manifest spells it. */
export type QsbManifestFunding = {
  readonly txid: string;
  readonly value_sat: number;
  readonly vout: number;
};

/** A vault record as the manifest spells it (snake_case, nullable fields). */
export type QsbManifestVault = {
  readonly disclosure: QsbDisclosure | null;
  readonly funding: QsbManifestFunding | null;
  readonly root: string;
  readonly script_hash: string | null;
  readonly script_pubkey: string | null;
  readonly state: QsbVaultState;
  readonly v: number;
};

/**
 * A version-1 manifest object; `JSON.stringify` of it is the file. Bramble
 * exports `bip39` only; `raw32` is valid format, refused on import here.
 */
export type QsbManifestV1 = {
  readonly format: typeof QSB_MANIFEST_FORMAT;
  readonly network: typeof QSB_NETWORK;
  readonly next_v: number;
  readonly profile: typeof QSB_PROFILE;
  readonly seed_source: "bip39" | "raw32";
  readonly vaults: readonly QsbManifestVault[];
  readonly version: typeof QSB_MANIFEST_VERSION;
};

/**
 * Resource bound for an untrusted manifest, derived from the journal limits:
 * a vault array no longer than an account may keep, five levels of nesting,
 * and strings no longer than the longest script or transaction hex. 64 KiB of
 * text per record covers a full-size script and transaction with room for
 * indentation. Objects may carry a few more members than the format's seven so
 * an unknown member is refused as `invalid-manifest`, by name, not as a budget.
 */
export const QSB_MANIFEST_BUDGET: JsonBudget = {
  maxArrayLength: MAX_QSB_VAULTS_PER_ACCOUNT,
  maxBytes: (MAX_QSB_VAULTS_PER_ACCOUNT + 1) * 64 * 1024,
  maxDepth: 5,
  maxNodes: 16 + MAX_QSB_VAULTS_PER_ACCOUNT * 64,
  maxObjectKeys: 16,
  maxStringLength: 2 * Math.max(QSB_MAX_SCRIPT_BYTES, QSB_MAX_TRANSACTION_BYTES),
};

/**
 * Why a manifest was refused. Strict-parse refusals pass through unchanged
 * (a vault array past the journal bound is `budget-exceeded`);
 * `invalid-manifest` is any structural rule of the format;
 * `unsupported-format`, `-version`, and `-profile` name a file this codec
 * does not read; `unsupported-source` is a valid `raw32` manifest, which
 * Bramble cannot hold.
 */
export type QsbManifestRefusal =
  | StrictJsonRefusal
  | "invalid-manifest"
  | "unsupported-format"
  | "unsupported-profile"
  | "unsupported-source"
  | "unsupported-version";

/**
 * A validated imported journal. Every record is `unknown`, or `retired` when
 * the manifest said so (retirement is never weakened), and the provenance is
 * `imported`: merging it can raise `nextV` but never makes an account a writer.
 */
export type ImportedQsbManifest = {
  readonly network: typeof QSB_NETWORK;
  readonly nextV: number;
  readonly seedContext: { readonly provenance: "imported"; readonly source: "bip39" };
  readonly vaults: readonly QsbVaultRecord[];
};

/** A validated import, or the single reason the manifest was refused. */
export type QsbManifestImport =
  | { readonly manifest: ImportedQsbManifest; readonly ok: true }
  | { readonly ok: false; readonly refusal: QsbManifestRefusal };

const toManifestVault = (vault: QsbVaultRecord): QsbManifestVault => ({
  v: vault.v,
  root: vault.root,
  script_pubkey: vault.scriptPubKey,
  script_hash: vault.scriptHash,
  funding:
    vault.funding === null
      ? null
      : { txid: vault.funding.txid, vout: vault.funding.vout, value_sat: vault.funding.valueSat },
  state: vault.state,
  disclosure:
    vault.disclosure === null
      ? null
      : {
          round0: [...vault.disclosure.round0],
          round1: [...vault.disclosure.round1],
          transaction: vault.disclosure.transaction,
          digest: vault.disclosure.digest,
        },
});

/**
 * Builds the version-1 manifest for one account from its bound journal: every
 * vault record the journal keeps (so every active and every retry-retained
 * exposed set), its mark, and the account's `seed_source` — and nothing else.
 * Returns null for an unbound journal rather than exporting a history no
 * importer could trust; a missing journal is never exported as an empty one.
 */
export const exportQsbManifest = (binding: QsbJournalBinding): QsbManifestV1 | null =>
  binding.status === "bound"
    ? {
        format: QSB_MANIFEST_FORMAT,
        version: QSB_MANIFEST_VERSION,
        profile: QSB_PROFILE,
        seed_source: binding.account.seedContext.source,
        network: QSB_NETWORK,
        next_v: binding.journal.nextV,
        vaults: binding.journal.vaults.map(toManifestVault),
      }
    : null;

const MANIFEST_KEYS = [
  "format",
  "network",
  "next_v",
  "profile",
  "seed_source",
  "vaults",
  "version",
] as const;

// Each nested member is copied into a fresh plain object under the record's
// own names, and only from the manifest's own spelling: anything else becomes
// a value isQsbVaultRecord refuses. Passing it through instead would let a
// manifest written in the record's camelCase validate as if it were the
// format.
const NOT_IN_FORMAT = false;

const fromManifestFunding = (value: unknown): unknown => {
  if (value === null) return null;
  return isRecord(value) && hasOnlyKnownKeys(value, ["txid", "value_sat", "vout"])
    ? { txid: value["txid"], valueSat: value["value_sat"], vout: value["vout"] }
    : NOT_IN_FORMAT;
};

const copiedList = (value: unknown): unknown => (Array.isArray(value) ? [...value] : NOT_IN_FORMAT);

const fromManifestDisclosure = (value: unknown): unknown => {
  if (value === null) return null;
  return isRecord(value) && hasOnlyKnownKeys(value, ["digest", "round0", "round1", "transaction"])
    ? {
        digest: value["digest"],
        round0: copiedList(value["round0"]),
        round1: copiedList(value["round1"]),
        transaction: value["transaction"],
      }
    : NOT_IN_FORMAT;
};

// Renames to the record's camelCase fields; isQsbVaultRecord then applies every
// grammar, range, and cross-field rule. An absent member stays undefined and is
// refused there, so presence is enforced along with shape.
const fromManifestVault = (value: unknown): QsbVaultRecord | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "disclosure",
      "funding",
      "root",
      "script_hash",
      "script_pubkey",
      "state",
      "v",
    ])
  ) {
    return null;
  }
  const record = {
    disclosure: fromManifestDisclosure(value["disclosure"]),
    funding: fromManifestFunding(value["funding"]),
    root: value["root"],
    scriptHash: value["script_hash"],
    scriptPubKey: value["script_pubkey"],
    state: value["state"],
    v: value["v"],
  };
  return isQsbVaultRecord(record) ? record : null;
};

// Imported history is never trusted as current: allocated and exposed sets
// become unknown; retired stays retired; unknown stays unknown.
const asImported = (vault: QsbVaultRecord): QsbVaultRecord =>
  vault.state === "retired" || vault.state === "unknown" ? vault : { ...vault, state: "unknown" };

const headerRefusal = (value: Record<string, unknown>): QsbManifestRefusal | null => {
  if (value["format"] !== QSB_MANIFEST_FORMAT) return "unsupported-format";
  if (value["version"] !== QSB_MANIFEST_VERSION) return "unsupported-version";
  if (value["profile"] !== QSB_PROFILE) return "unsupported-profile";
  if (value["seed_source"] === "raw32") return "unsupported-source";
  return value["seed_source"] === "bip39" && value["network"] === QSB_NETWORK
    ? null
    : "invalid-manifest";
};

const readManifest = (value: unknown): QsbManifestImport => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, MANIFEST_KEYS)) {
    return { ok: false, refusal: "invalid-manifest" };
  }
  const refusal = headerRefusal(value);
  if (refusal !== null) {
    return { ok: false, refusal };
  }
  const nextV = value["next_v"];
  const listed = value["vaults"];
  const vaults = Array.isArray(listed) ? listed.map(fromManifestVault) : null;
  if (
    !isQsbHighWaterMark(nextV) ||
    vaults === null ||
    !vaults.every((vault): vault is QsbVaultRecord => vault !== null) ||
    !isQsbJournalOrder(vaults, nextV)
  ) {
    return { ok: false, refusal: "invalid-manifest" };
  }
  return {
    manifest: {
      network: QSB_NETWORK,
      nextV,
      seedContext: { provenance: "imported", source: "bip39" },
      vaults: vaults.map(asImported),
    },
    ok: true,
  };
};

/**
 * Reads an untrusted manifest file, as UTF-8 bytes (preferred: invalid UTF-8
 * is refused rather than replaced) or as already-decoded text. Total: every
 * failure is a typed refusal, never a throw, and never a partial journal.
 */
export const importQsbManifest = (input: string | Uint8Array): QsbManifestImport => {
  const options = { budget: QSB_MANIFEST_BUDGET, integersOnly: true };
  const parsed =
    typeof input === "string"
      ? parseStrictJson(input, options)
      : parseStrictJsonBytes(input, options);
  return parsed.ok ? readManifest(parsed.value) : { ok: false, refusal: parsed.refusal };
};
