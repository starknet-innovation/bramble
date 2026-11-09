/**
 * The vault service's QSB vault surface, split from ./service-types by
 * behaviour: one serialized session over one QSB account, through which the
 * background reads and advances the account's disclosure journal, keeps its
 * pending deposits, and has Krusty derive and sign with the account's keys.
 * Types only.
 *
 * Trust boundary: the session hands out what a deposit needs and never what
 * would let a caller act without it. The phrase, the owner's private key and
 * the journal id stay inside the vault service: the owner key is derived on
 * demand for each use and never kept, persisted or returned; the caller
 * receives public data (commitments, the owner's address and public key, a
 * sign-in proof, signed PSBT bytes) and the journal's vault records, never
 * the account record or its header. A session ends with its task; using it afterwards throws.
 */
import type { QsbCommitments, QsbRevealDigest } from "../kms-port";
import type { QsbPendingDeposit } from "../qsb/qsb-deposit-store";
import type { QsbJournalRefusal } from "../qsb/qsb-journal";
import type { ImportedQsbJournal } from "../qsb/qsb-merge";
import type { QsbFunding, QsbVaultRecord } from "../qsb/qsb-vault-record";
import type {
  QsbSignedWithdrawalRecord,
  QsbWithdrawalOutcome,
  QsbWithdrawalRecord,
} from "../qsb/qsb-withdrawal-store";

/** The account's Bitcoin owner: BIP-84 `m/84'/0'/0'/0/0` of its own phrase. */
export type QsbOwner = {
  readonly address: string;
  readonly publicKey: string;
};

/**
 * The journal as a session may see it: whether it is bound, whether this
 * account is its writer, the high-water mark and the vault records. No
 * header: neither the journal id nor the account record crosses.
 */
export type QsbJournalState =
  | {
      readonly nextV: number;
      readonly status: "bound";
      readonly vaults: readonly QsbVaultRecord[];
      readonly writer: boolean;
    }
  | { readonly status: "unavailable" };

/**
 * One journal transition a session may ask for, by name: allocate the next
 * vault with Krusty's root, associate its checked script, record its
 * confirmed funding, mark its history unknown, or merge the `unknown`
 * records a read-only account recovered from the coordinator. Each is the
 * journal's own pure transition (`../qsb/qsb-journal`, `../qsb/qsb-merge`),
 * applied inside the vault service. A merge that changes no field writes
 * nothing.
 */
export type QsbJournalChange =
  | { readonly kind: "allocate"; readonly root: string; readonly v: number }
  | {
      readonly kind: "associate";
      readonly scriptHash: string;
      readonly scriptPubKey: string;
      readonly v: number;
    }
  | { readonly funding: QsbFunding; readonly kind: "fund"; readonly v: number }
  | { readonly kind: "mark-unknown"; readonly v: number }
  | { readonly journal: ImportedQsbJournal; readonly kind: "recover" };

/** The journal after a change, or why the change was refused. */
export type QsbJournalChangeResult =
  | {
      readonly journal: Extract<QsbJournalState, { readonly status: "bound" }>;
      readonly ok: true;
    }
  | { readonly ok: false; readonly refusal: QsbJournalRefusal };

/**
 * One QSB account's session. Each call is one slot of the vault's mutation
 * queue over the account as stored at that moment. Every journal write is
 * durable before the call resolves; so is every pending-deposit write. A
 * refused journal change resolves with its refusal and writes nothing.
 */
export type QsbVaultAccess = QsbWithdrawalAccess & {
  /** The id of the account this session is over. */
  readonly accountId: string;
  /**
   * Applies `change` to the journal as it is now and, when it changed
   * anything, durably replaces the journal with the result. A journal lost
   * since it was read is never recreated (`journal-unavailable`).
   */
  readonly commit: (change: QsbJournalChange) => Promise<QsbJournalChangeResult>;
  /** Krusty's QSB-HORS-v1 commitments of vault `v` of this account's phrase. */
  readonly commitments: (v: number) => Promise<QsbCommitments>;
  /**
   * Keeps `deposit` pending, durably, re-checking in its slot that its vault is
   * still `allocated`, unfunded and has its script (else `notDepositable`) and
   * that no other bytes are kept for it (else `depositPending`); the same
   * bytes again change nothing. Throws the journal-unavailable refusal when
   * the record cannot be read, and `depositPending` when it is full.
   */
  readonly holdDeposit: (deposit: QsbPendingDeposit) => Promise<void>;
  /** The account's journal, read and bound now, as its vault records. */
  readonly journal: () => Promise<QsbJournalState>;
  /** The owner address and public key, derived now. */
  readonly owner: () => Promise<QsbOwner>;
  /**
   * The pending deposits, or null when the record cannot be read (every
   * deposit is then refused).
   */
  readonly pendingDeposits: () => Promise<readonly QsbPendingDeposit[] | null>;
  /**
   * Drops the pending deposit for vault `v` if it is the transaction `txid`;
   * anything else is left alone. Durable.
   */
  readonly releaseDeposit: (v: number, txid: string) => Promise<void>;
  /**
   * The owner key's SIGHASH_ALL partial signatures on inputs `0..inputCount-1`
   * of a version-0 PSBT, which Krusty checks spend the owner's own outputs.
   */
  readonly signDeposit: (psbt: Uint8Array, inputCount: number) => Promise<Uint8Array>;
  /** The owner key's unprefixed BIP-322 proof over `message`. */
  readonly signSignIn: (message: string) => Promise<string>;
};

/**
 * One disclosure the release is asked for: vault `v`, the transaction `T` as
 * lowercase hex, the 8 round-0 and 7 round-1 indices in signing order, the
 * digest `D` the user reviewed, and whether the user reviewed it as an
 * emergency release (outside custody conformance), which must match the
 * account: false for the writer, true for a read-only account.
 */
export type QsbReleaseRequest = {
  readonly digest: string;
  readonly emergency: boolean;
  readonly round0: readonly number[];
  readonly round1: readonly number[];
  readonly transaction: string;
  readonly v: number;
};

/**
 * The withdrawal half of a session (./qsb-vault-withdrawals). Every write is
 * durable before its call resolves and is re-validated in its own slot.
 */
export type QsbWithdrawalAccess = {
  /**
   * Keeps a withdrawal a read-only account recovered from the coordinator,
   * durably: its job already created (`jobCreated` true), nothing signed and
   * no outcome. Refused unless the account is not the writer
   * (`recoveryNotNeeded`) and vault `v` is `unknown`, scripted, funded and not
   * yet disclosed (`notWithdrawable`); the same withdrawal again changes
   * nothing, any other for `v` is `notWithdrawable`, a helper another
   * withdrawal holds is `helperNeeded`, and a full or invalid record is
   * `vaultLimit`.
   */
  readonly adoptWithdrawal: (record: QsbWithdrawalRecord) => Promise<void>;
  /**
   * Keeps a withdrawal's intent, durably, before its job is created: refused
   * unless the account is the writer, vault `v` is allocated, funded and
   * scripted, and no other intent exists for `v` (the same intent again
   * changes nothing) or uses its helper. Refused when the record is full.
   */
  readonly holdWithdrawal: (intent: QsbWithdrawalRecord) => Promise<void>;
  /** Records that the coordinator created exactly this withdrawal's job. Durable. */
  readonly markWithdrawalJob: (v: number) => Promise<void>;
  /**
   * Keeps a withdrawal's signed bytes, durably, before they are submitted,
   * with the outcome `pending`; only once vault `v`'s release is recorded
   * under the account's custody: `exposed` for the writer, `unknown` with
   * this install's emergency disclosure for a read-only account. The same
   * bytes again change nothing; any others are refused.
   */
  readonly keepSignedWithdrawal: (v: number, signed: QsbSignedWithdrawalRecord) => Promise<void>;
  /** Records what the coordinator last said about withdrawal `v`. Durable. */
  readonly recordWithdrawalOutcome: (v: number, outcome: QsbWithdrawalOutcome) => Promise<void>;
  /**
   * The ONE way a preimage leaves the vault service. In a single slot: re-reads
   * the bound journal, refuses a request whose `emergency` does not match the
   * account (the writer releases conformantly, a read-only account only as an
   * emergency), has Krusty compute `D` from the parsed `T`, refuses unless it
   * is the reviewed digest, records the disclosure and makes it durable, and
   * only then has Krusty reveal the 15 preimages. The writer records vault
   * `v`'s exposure (from `allocated`, or an exact retry); a read-only account
   * attaches it to the `unknown` record, which stays `unknown` (or retries it
   * exactly). Any refusal releases nothing.
   */
  readonly releasePreimages: (request: QsbReleaseRequest) => Promise<readonly string[]>;
  /** Krusty's disclosure digest of `T` and the indices; reveals nothing. */
  readonly revealDigest: (
    transaction: string,
    round0: readonly number[],
    round1: readonly number[],
  ) => Promise<QsbRevealDigest>;
  /**
   * The owner key's SIGHASH_ALL partial signature on input 0 of vault `v`'s
   * withdrawal PSBT only, refused (signing nothing) until `v`'s release is
   * recorded under the account's custody, as for `keepSignedWithdrawal`.
   */
  readonly signWithdrawal: (v: number, psbt: Uint8Array) => Promise<Uint8Array>;
  /** The withdrawals, or null when the record cannot be read. */
  readonly withdrawals: () => Promise<readonly QsbWithdrawalRecord[] | null>;
};

/** Which account to open a session over, under the session's password. */
export type QsbVaultAccessInput = {
  readonly accountId: string;
  readonly vaultPassphrase: string;
};

/**
 * The method. Opens a session over one account and resolves with what `task`
 * resolves with. The session holds no slot of the vault's mutation queue:
 * each of its calls takes one short slot, re-reading and re-validating what it
 * depends on, so a task may wait on the network or a runtime between calls
 * without blocking any other vault operation. Serializing one account's
 * flows end to end is the caller's (the background's per-account QSB lock).
 * Refuses an unknown account (`unknownAccount`) and a service without QSB
 * wiring (`journalUnavailable`) before `task` runs.
 */
export type QsbVaultAccessService = {
  readonly withQsbVaultAccount: <T>(
    input: QsbVaultAccessInput,
    task: (access: QsbVaultAccess) => Promise<T>,
  ) => Promise<T>;
};
