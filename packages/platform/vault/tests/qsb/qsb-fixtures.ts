/**
 * Full-length QSB fixtures shared by the QSB suites: published BIP-39 test
 * phrases (24 words, public, never for funds), the QSB BIP's own root and
 * digest vectors, a commitment-sized deposit script with its real SHA-256,
 * and a binding transaction `T` serialized byte for byte as the BIP defines
 * it. Nothing here is a short stub, so a length or ordering bug cannot hide.
 */
import { createHash } from "node:crypto";
import type { QsbAccountRecord } from "@bramble/vault/qsb-account";
import {
  type BoundQsbJournal,
  bindQsbJournal,
  QSB_JOURNAL_SCHEMA_VERSION,
  type QsbJournal,
} from "@bramble/vault/qsb-journal-record";
import type { QsbDisclosure, QsbFunding, QsbVaultRecord } from "@bramble/vault/qsb-vault-record";

/** BIP-39 English test vector (entropy 0x00 * 32). */
export const PHRASE_A = `${"abandon ".repeat(23)}art`;
/** BIP-39 English test vector (entropy 0x7f * 32). */
export const PHRASE_B =
  "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title";
/** BIP-39 English test vector (entropy 0x80 * 32). */
export const PHRASE_C =
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless";

/** QSB BIP vector R(net=0, v=0). */
export const ROOT_V0 = "9b257b6acd00017b1488ed9d73d05bc8a5dbdd43c8aa54d1d37c7e807d65c515";
/** QSB BIP vector R(net=0, v=7). */
export const ROOT_V7 = "8ea0f0b0ac0db4db0405bedf47bd3c54fe946e5d1ed3a158fb11a72580940e11";
// QSB BIP digest vector D for the round indices below.
const BIP_DIGEST = "498b1ea9b6c381e78fc76f0a9c2003b1d29ef25caf92d5a3b6a1d7dbc90f7d2c";
// QSB BIP disclosure vector indices.
const ROUND0 = [0, 1, 2, 3, 4, 5, 6, 7] as const;
// QSB BIP disclosure vector indices.
const ROUND1 = [140, 141, 142, 143, 144, 145, 146] as const;

/** Lowercase hex SHA-256 of hex-encoded bytes. */
export const sha256Hex = (hex: string): string =>
  createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");

const tagged = (tag: string): string => createHash("sha256").update(tag).digest("hex");

// A deposit script the size of the QSB template: 300 pushes of distinct
// 20-byte commitments (OP_PUSHBYTES_20) and a closing OP_CHECKSIG.
const commitmentScript = (label: string): string =>
  `${Array.from({ length: 300 }, (_, index) => `14${tagged(`${label}/${index}`).slice(0, 40)}`).join("")}ac`;

/** A 6,301-byte deposit script and its real hash. */
export const SCRIPT = commitmentScript("vault-0");
/** SHA-256 of {@link SCRIPT}. */
export const SCRIPT_HASH = sha256Hex(SCRIPT);
/** A different script of the same shape, for conflicting histories. */
export const OTHER_SCRIPT = commitmentScript("vault-0-other");

/** The deposit that funded the vault script (txid in display order). */
export const FUNDING: QsbFunding = { txid: tagged("funding"), valueSat: 250_000, vout: 1 };
/** A second, unrelated outpoint (a fee input). */
export const FEE_OUTPOINT = { txid: tagged("fee input"), vout: 0 };

const littleEndian = (value: bigint, bytes: number): string =>
  Array.from({ length: bytes }, (_, index) =>
    Number((value >> BigInt(index * 8)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("");

const compactSize = (value: number): string =>
  value < 0xfd ? littleEndian(BigInt(value), 1) : `fd${littleEndian(BigInt(value), 2)}`;

// Display-order txid to the internal byte order a serialized outpoint uses.
const internalOrder = (txid: string): string => (txid.match(/../g) ?? []).reverse().join("");

/** A P2TR destination script. */
export const P2TR = `5120${tagged("destination")}`;

/**
 * Serializes a legacy transaction exactly as the BIP's `T`: version 2, the
 * given inputs with empty scriptSigs, the given outputs, locktime 0.
 */
export const bindingTransaction = (
  inputs: readonly { readonly txid: string; readonly vout: number }[],
  outputs: readonly { readonly script: string; readonly valueSat: number }[],
  sequence = "fdffffff",
): string =>
  [
    littleEndian(2n, 4),
    compactSize(inputs.length),
    ...inputs.map(
      (input) => `${internalOrder(input.txid)}${littleEndian(BigInt(input.vout), 4)}00${sequence}`,
    ),
    compactSize(outputs.length),
    ...outputs.map(
      (output) =>
        `${littleEndian(BigInt(output.valueSat), 8)}${compactSize(output.script.length / 2)}${output.script}`,
    ),
    littleEndian(0n, 4),
  ].join("");

/** T spending the vault and a fee input to one P2TR output. */
export const TRANSACTION = bindingTransaction(
  [FUNDING, FEE_OUTPOINT],
  [{ script: P2TR, valueSat: 240_000 }],
);

/** The vault's one disclosure, with the BIP's ordered indices. */
export const DISCLOSURE: QsbDisclosure = {
  digest: BIP_DIGEST,
  round0: [...ROUND0],
  round1: [...ROUND1],
  transaction: TRANSACTION,
};

/** A freshly allocated record. */
export const allocatedVault = (v: number, root = ROOT_V0): QsbVaultRecord => ({
  disclosure: null,
  funding: null,
  root,
  scriptHash: null,
  scriptPubKey: null,
  state: "allocated",
  v,
});

/** An allocated record with its script associated and its deposit recorded. */
export const fundedVault = (v: number): QsbVaultRecord => ({
  ...allocatedVault(v),
  funding: FUNDING,
  scriptHash: SCRIPT_HASH,
  scriptPubKey: SCRIPT,
});

/** The same record once its disclosure is committed. */
export const exposedVault = (v: number): QsbVaultRecord => ({
  ...fundedVault(v),
  disclosure: DISCLOSURE,
  state: "exposed",
});

/** Journal ids: 32 random-looking bytes each, as the background would draw. */
export const JOURNAL_ID_A = tagged("journal a");
/** A second journal id. */
export const JOURNAL_ID_B = tagged("journal b");

/** A writer's vault record: generated here, backup confirmed. */
export const writerAccount = (): QsbAccountRecord => ({
  backupConfirmed: true,
  id: "qsb-1",
  journalId: JOURNAL_ID_A,
  mnemonic: PHRASE_A,
  network: "bitcoin-mainnet",
  seedContext: { provenance: "generated-here", source: "bip39" },
});

/** A read-only account's vault record, holding an imported phrase. */
export const importedAccount = (): QsbAccountRecord => ({
  backupConfirmed: true,
  id: "qsb-2",
  journalId: JOURNAL_ID_B,
  mnemonic: PHRASE_B,
  network: "bitcoin-mainnet",
  seedContext: { provenance: "imported", source: "bip39" },
});

/** One account's journal; `nextV` defaults to one past the last record. */
export const journalFor = (
  account: QsbAccountRecord,
  vaults: readonly QsbVaultRecord[] = [],
  nextV = vaults.length === 0 ? 0 : (vaults.at(-1)?.v ?? 0) + 1,
): QsbJournal => ({
  accountId: account.id,
  journalId: account.journalId,
  network: "bitcoin-mainnet",
  nextV,
  profile: "QSB-HORS-v1",
  schemaVersion: QSB_JOURNAL_SCHEMA_VERSION,
  vaults,
});

/** The account bound to its journal; throws if the pair is not bindable. */
export const bound = (
  account: QsbAccountRecord,
  vaults: readonly QsbVaultRecord[] = [],
  nextV?: number,
): BoundQsbJournal => {
  const binding = bindQsbJournal(account, {
    status: "present",
    value: journalFor(account, vaults, nextV),
  });
  if (binding.status !== "bound") throw new Error(`unbound fixture: ${binding.reason}`);
  return binding;
};
