/**
 * Pure transitions of the QSB disclosure journal (BIP "QSB Wallet Secret
 * Management", profile QSB-HORS-v1, sections "Allocation" and "Disclosure
 * lifecycle"). Each takes an account record and returns either the next
 * record or a typed refusal; none reads a clock, randomness, storage, or the
 * network, and none mutates its input.
 *
 * Ordering is the caller's contract: a transition only computes the next
 * journal. The background must durably write the returned record (in the same
 * encrypted-vault write as the phrase) before it publishes an allocated
 * commitment or releases any preimage, and must serialize transitions so two
 * requests can never both pass an unused-state check. When a transition
 * changes nothing (an exact retry, a repeated retire) it returns the same
 * account reference, so the caller can skip the write.
 */
import { isLowercaseHexBytes } from "@bramble/core/hex";
import {
  isQsbAccountRecord,
  isQsbVaultRecord,
  isQsbWriter,
  MAX_QSB_VAULTS_PER_ACCOUNT,
  QSB_VAULT_INDEX_LIMIT,
  type QsbAccountRecord,
  type QsbDisclosure,
  type QsbFunding,
  type QsbVaultRecord,
} from "./qsb-account";

/**
 * Why a journal transition was refused. A code, not copy:
 * - `allocation-exhausted`: `nextV` reached 2^31; it never wraps;
 * - `invalid-request`: a malformed root, script, funding, or disclosure, or a
 *   result that would not be a valid record;
 * - `journal-full`: the account already keeps its bound of vault records;
 * - `not-writer`: an imported phrase, or a backup not yet confirmed;
 * - `record-mismatch`: the request differs from what is already committed
 *   (another script or funding, or an exposure that is not an exact retry);
 * - `stale-index`: an allocation for any index but the current `nextV`;
 * - `state-conflict`: the transition is not allowed from the record's state;
 * - `unknown-vault`: no record for that index (a missing index below `nextV`
 *   is reserved for good and can never be allocated or disclosed);
 * - `writer-journal`: a merge into a journal this vault is the writer of.
 */
export type QsbJournalRefusal =
  | "allocation-exhausted"
  | "invalid-request"
  | "journal-full"
  | "not-writer"
  | "record-mismatch"
  | "stale-index"
  | "state-conflict"
  | "unknown-vault"
  | "writer-journal";

/** The next account record, or the reason the transition was refused. */
export type QsbJournalResult =
  | { readonly account: QsbAccountRecord; readonly ok: true }
  | { readonly ok: false; readonly refusal: QsbJournalRefusal };

const refused = (refusal: QsbJournalRefusal): QsbJournalResult => ({ ok: false, refusal });

const unchanged = (account: QsbAccountRecord): QsbJournalResult => ({ account, ok: true });

/**
 * Wraps a changed account as a result after re-validating it whole, so no
 * transition can hand back what the vault validator would later refuse to
 * read; an invalid account is `invalid-request`.
 */
export const checkedQsbAccount = (account: QsbAccountRecord): QsbJournalResult =>
  isQsbAccountRecord(account) ? { account, ok: true } : refused("invalid-request");

const vaultAt = (account: QsbAccountRecord, v: number): QsbVaultRecord | undefined =>
  account.vaults.find((vault) => vault.v === v);

const withVault = (account: QsbAccountRecord, next: QsbVaultRecord): QsbJournalResult =>
  isQsbVaultRecord(next)
    ? checkedQsbAccount({
        ...account,
        vaults: account.vaults.map((vault) => (vault.v === next.v ? next : vault)),
      })
    : refused("invalid-request");

const sameIndices = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((index, position) => right[position] === index);

/** Exact equality of two funding records (display-order txid, vout, amount). */
export const sameQsbFunding = (left: QsbFunding | null, right: QsbFunding | null): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.txid === right.txid &&
    left.vout === right.vout &&
    left.valueSat === right.valueSat);

/** Exact equality of two disclosures, index order included (never sorted). */
export const sameQsbDisclosure = (
  left: QsbDisclosure | null,
  right: QsbDisclosure | null,
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.digest === right.digest &&
    left.transaction === right.transaction &&
    sameIndices(left.round0, right.round0) &&
    sameIndices(left.round1, right.round1));

// Equal on everything committed before a disclosure: index, root, script, and
// funding. Exposure adds only the disclosure on top of these.
const sameCommitments = (left: QsbVaultRecord, right: QsbVaultRecord): boolean =>
  left.v === right.v &&
  left.root === right.root &&
  left.scriptPubKey === right.scriptPubKey &&
  left.scriptHash === right.scriptHash &&
  sameQsbFunding(left.funding, right.funding);

/**
 * Exact equality of two vault records, field by field. The retry rule is
 * stated in these terms: an exposed record may only ever be re-requested
 * whole.
 */
export const sameQsbVaultRecord = (left: QsbVaultRecord, right: QsbVaultRecord): boolean =>
  sameCommitments(left, right) &&
  left.state === right.state &&
  sameQsbDisclosure(left.disclosure, right.disclosure);

/**
 * Reserves the current `nextV` for a new deposit and advances the mark, with
 * the commitment root Krusty derived for exactly that index. Only a writer may
 * allocate; `v` must equal `nextV`, so a root derived for a stale index is
 * refused; at 2^31 allocation fails rather than wraps; a full journal refuses.
 */
export const allocateQsbVault = (
  account: QsbAccountRecord,
  request: { readonly root: string; readonly v: number },
): QsbJournalResult => {
  if (!isQsbWriter(account)) return refused("not-writer");
  if (account.nextV >= QSB_VAULT_INDEX_LIMIT) return refused("allocation-exhausted");
  if (request.v !== account.nextV) return refused("stale-index");
  if (!isLowercaseHexBytes(request.root, 32, 32)) return refused("invalid-request");
  if (account.vaults.length >= MAX_QSB_VAULTS_PER_ACCOUNT) return refused("journal-full");
  const vault: QsbVaultRecord = {
    disclosure: null,
    funding: null,
    root: request.root,
    scriptHash: null,
    scriptPubKey: null,
    state: "allocated",
    v: request.v,
  };
  return checkedQsbAccount({
    ...account,
    nextV: account.nextV + 1,
    vaults: [...account.vaults, vault],
  });
};

/**
 * Associates the finalized deposit script with an allocated vault, after the
 * background has checked every embedded commitment against Krusty's and
 * computed `scriptHash`. Writer-only. Once set, a script never changes: the
 * same script again is a no-op, any other is `record-mismatch`.
 */
export const associateQsbScript = (
  account: QsbAccountRecord,
  request: { readonly scriptHash: string; readonly scriptPubKey: string; readonly v: number },
): QsbJournalResult => {
  if (!isQsbWriter(account)) return refused("not-writer");
  const vault = vaultAt(account, request.v);
  if (vault === undefined) return refused("unknown-vault");
  if (vault.state !== "allocated") return refused("state-conflict");
  if (vault.scriptPubKey !== null) {
    return vault.scriptPubKey === request.scriptPubKey && vault.scriptHash === request.scriptHash
      ? unchanged(account)
      : refused("record-mismatch");
  }
  return withVault(account, {
    ...vault,
    scriptHash: request.scriptHash,
    scriptPubKey: request.scriptPubKey,
  });
};

/**
 * Records the deposit output that funded a vault's script, after the
 * background has checked it against the actual funding transaction. Funding is
 * metadata: it never changes the disclosure state, so any account may record
 * it, but only once — the same output again is a no-op, another is
 * `record-mismatch` (a key set is never funded twice).
 */
export const recordQsbFunding = (
  account: QsbAccountRecord,
  request: { readonly funding: QsbFunding; readonly v: number },
): QsbJournalResult => {
  const vault = vaultAt(account, request.v);
  if (vault === undefined) return refused("unknown-vault");
  if (vault.scriptPubKey === null) return refused("state-conflict");
  if (vault.funding !== null) {
    return sameQsbFunding(vault.funding, request.funding)
      ? unchanged(account)
      : refused("record-mismatch");
  }
  return withVault(account, { ...vault, funding: request.funding });
};

/**
 * Commits the one disclosure of a key set. `proposed` is the whole exposed
 * record the background built from the parsed transaction: from `allocated`,
 * its root, script, and recorded funding must match what is committed; from
 * `exposed`, only an exact retry of the whole record is accepted, and returns
 * the account unchanged. Anything else — another transaction, another index
 * order, a retired or unknown key set — is refused. Writer-only. The returned
 * record must be durable before any preimage is released. An accepted retry
 * only says the journal permits it; a new session still needs a fresh user
 * authorization, which the background enforces.
 */
export const recordQsbExposure = (
  account: QsbAccountRecord,
  proposed: QsbVaultRecord,
): QsbJournalResult => {
  if (!isQsbWriter(account)) return refused("not-writer");
  if (!isQsbVaultRecord(proposed) || proposed.state !== "exposed") {
    return refused("invalid-request");
  }
  const vault = vaultAt(account, proposed.v);
  if (vault === undefined) return refused("unknown-vault");
  if (vault.state === "exposed") {
    return sameQsbVaultRecord(vault, proposed) ? unchanged(account) : refused("record-mismatch");
  }
  if (vault.state !== "allocated") return refused("state-conflict");
  return sameCommitments(vault, proposed)
    ? withVault(account, proposed)
    : refused("record-mismatch");
};

/**
 * Retires a key set for good: no further disclosure, ever, and every recorded
 * script, funding, and disclosure is kept. Allowed from any state, by any
 * account, because it only ever restricts; retiring a retired set is a no-op.
 */
export const retireQsbVault = (account: QsbAccountRecord, v: number): QsbJournalResult => {
  const vault = vaultAt(account, v);
  if (vault === undefined) return refused("unknown-vault");
  return vault.state === "retired"
    ? unchanged(account)
    : withVault(account, { ...vault, state: "retired" });
};

/**
 * Marks a key set's history uncertain, keeping every recorded field. Nothing
 * leaves `unknown` but retirement: recovering it needs trustworthy history,
 * which this layer cannot establish. A retired set stays retired
 * (`state-conflict`); an unknown one is a no-op.
 */
export const markQsbVaultUnknown = (account: QsbAccountRecord, v: number): QsbJournalResult => {
  const vault = vaultAt(account, v);
  if (vault === undefined) return refused("unknown-vault");
  if (vault.state === "unknown") return unchanged(account);
  if (vault.state === "retired") return refused("state-conflict");
  return withVault(account, { ...vault, state: "unknown" });
};
