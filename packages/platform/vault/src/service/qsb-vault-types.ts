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
import type { QsbCommitments } from "../kms-port";
import type { QsbPendingDeposit } from "../qsb/qsb-deposit-store";
import type { QsbJournalRefusal } from "../qsb/qsb-journal";
import type { QsbFunding, QsbVaultRecord } from "../qsb/qsb-vault-record";

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
 * confirmed funding, or mark its history unknown. Each is the journal's own
 * pure transition (`../qsb/qsb-journal`), applied inside the vault service.
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
  | { readonly kind: "mark-unknown"; readonly v: number };

/** The journal after a change, or why the change was refused. */
export type QsbJournalChangeResult =
  | {
      readonly journal: Extract<QsbJournalState, { readonly status: "bound" }>;
      readonly ok: true;
    }
  | { readonly ok: false; readonly refusal: QsbJournalRefusal };

/**
 * One QSB account's session. Every journal write is durable before the call
 * resolves; so is every pending-deposit write. A refused journal change
 * resolves with its refusal and writes nothing.
 */
export type QsbVaultAccess = {
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
   * Keeps `deposit` pending, replacing any for its vault, durably. Throws the
   * journal-unavailable refusal when the record cannot be read, and the
   * deposit-pending refusal when the record is full.
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

/** Which account to open a session over, under the session's password. */
export type QsbVaultAccessInput = {
  readonly accountId: string;
  readonly vaultPassphrase: string;
};

/**
 * The method. Runs `task` inside the vault's mutation queue, so no journal,
 * pending-deposit or vault write overlaps it, and resolves with what `task`
 * resolves with. Refuses an unknown account (`unknownAccount`) and a service
 * without QSB wiring (`journalUnavailable`) before `task` runs.
 */
export type QsbVaultAccessService = {
  readonly withQsbVaultAccount: <T>(
    input: QsbVaultAccessInput,
    task: (access: QsbVaultAccess) => Promise<T>,
  ) => Promise<T>;
};
