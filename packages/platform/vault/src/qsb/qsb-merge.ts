/**
 * Merging an imported QSB journal into a read-only QSB account's own journal
 * (BIP "QSB Wallet Secret Management", "Backup, restoration, and multiple
 * devices"). Pure: no clock, randomness, storage, or network, and no input is
 * mutated. The result is a journal for the account's journal key, written
 * under the same ordering contract as every other transition.
 *
 * The rules are the BIP's. Exposed or retired information is never weakened;
 * different roots, scripts, funding, or disclosures for one index make that
 * record `unknown`; the larger high-water mark is kept, which reserves more
 * indices but never makes the account a writer. A merge never drops a record:
 * a union past the journal bound is refused whole.
 */
import {
  checkedQsbJournal,
  type QsbJournalResult,
  sameQsbDisclosure,
  sameQsbFunding,
} from "./qsb-journal";
import type { QsbJournalBinding } from "./qsb-journal-record";
import {
  isQsbHighWaterMark,
  isQsbJournalOrder,
  isQsbVaultRecord,
  MAX_QSB_VAULTS_PER_ACCOUNT,
  type QsbVaultRecord,
  type QsbVaultState,
} from "./qsb-vault-record";

/**
 * A journal read from a recovery manifest: its high-water mark and records,
 * each already `unknown` or `retired`. It carries no phrase and no writer
 * authority; the background has re-checked it against the phrase through
 * Krusty before merging it.
 */
export type ImportedQsbJournal = {
  readonly nextV: number;
  readonly vaults: readonly QsbVaultRecord[];
};

// Most restrictive first: retired refuses for good, unknown until trustworthy
// history exists, exposed admits only an exact retry, allocated admits one
// disclosure. A merge keeps the most restrictive state either side holds.
const RESTRICTION: Readonly<Record<QsbVaultState, number>> = {
  allocated: 0,
  exposed: 1,
  retired: 3,
  unknown: 2,
};

const stricter = (left: QsbVaultState, right: QsbVaultState): QsbVaultState =>
  RESTRICTION[left] >= RESTRICTION[right] ? left : right;

const conflicting = <T>(
  left: T | null,
  right: T | null,
  same: (a: T | null, b: T | null) => boolean,
): boolean => left !== null && right !== null && !same(left, right);

const sameText = (left: string | null, right: string | null): boolean => left === right;

const conflicts = (local: QsbVaultRecord, incoming: QsbVaultRecord): boolean =>
  local.root !== incoming.root ||
  conflicting(local.scriptPubKey, incoming.scriptPubKey, sameText) ||
  conflicting(local.scriptHash, incoming.scriptHash, sameText) ||
  conflicting(local.funding, incoming.funding, sameQsbFunding) ||
  conflicting(local.disclosure, incoming.disclosure, sameQsbDisclosure);

// Two histories of one index. Where they agree, each fills what the other
// lacks. Where they conflict, the local fields are kept and the record becomes
// at least `unknown`: it can never disclose again, so which history it shows
// no longer gates anything. Either way an imported side is at least `unknown`.
const mergeVault = (local: QsbVaultRecord, incoming: QsbVaultRecord): QsbVaultRecord => {
  const state = stricter(stricter(local.state, incoming.state), "unknown");
  if (conflicts(local, incoming)) {
    return { ...local, state };
  }
  return {
    disclosure: local.disclosure ?? incoming.disclosure,
    funding: local.funding ?? incoming.funding,
    root: local.root,
    scriptHash: local.scriptHash ?? incoming.scriptHash,
    scriptPubKey: local.scriptPubKey ?? incoming.scriptPubKey,
    state,
    v: local.v,
  };
};

const isImportedJournal = (journal: ImportedQsbJournal): boolean =>
  isQsbHighWaterMark(journal.nextV) &&
  Array.isArray(journal.vaults) &&
  journal.vaults.every(
    (vault) => isQsbVaultRecord(vault) && (vault.state === "unknown" || vault.state === "retired"),
  ) &&
  isQsbJournalOrder(journal.vaults, journal.nextV);

const mergedVaults = (
  local: readonly QsbVaultRecord[],
  incoming: readonly QsbVaultRecord[],
): QsbVaultRecord[] => {
  const byIndex = new Map(local.map((vault) => [vault.v, vault]));
  for (const vault of incoming) {
    const existing = byIndex.get(vault.v);
    byIndex.set(vault.v, existing === undefined ? vault : mergeVault(existing, vault));
  }
  return [...byIndex.values()].sort((left, right) => left.v - right.v);
};

/**
 * Merges an imported journal into an imported (read-only) account's bound
 * journal. Refuses an unbound journal (`journal-unavailable`): a lost journal
 * is never rebuilt from a manifest. Refuses a merge into a `generated-here`
 * account (`writer-journal`): its journal is the one authoritative writer's,
 * and another history for its phrase means a second copy existed, which a
 * merge cannot make safe. Refuses a malformed journal (`invalid-request`) and
 * a union past the record bound or byte cap (`journal-full`).
 */
export const mergeImportedQsbJournal = (
  binding: QsbJournalBinding,
  imported: ImportedQsbJournal,
): QsbJournalResult => {
  if (binding.status !== "bound") {
    return { ok: false, refusal: "journal-unavailable" };
  }
  if (binding.account.seedContext.provenance !== "imported") {
    return { ok: false, refusal: "writer-journal" };
  }
  if (!isImportedJournal(imported)) {
    return { ok: false, refusal: "invalid-request" };
  }
  const vaults = mergedVaults(binding.journal.vaults, imported.vaults);
  if (vaults.length > MAX_QSB_VAULTS_PER_ACCOUNT) {
    return { ok: false, refusal: "journal-full" };
  }
  return checkedQsbJournal(binding.account, {
    ...binding.journal,
    nextV: Math.max(binding.journal.nextV, imported.nextV),
    vaults,
  });
};
