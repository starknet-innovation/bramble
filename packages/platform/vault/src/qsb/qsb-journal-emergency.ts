/**
 * The emergency disclosure of the QSB journal (BIP "QSB Wallet Secret
 * Management", "Backup, restoration, and multiple devices"): after the
 * authoritative writer is lost, restored records stay `unknown`, and the one
 * way to release a deposit's keys is an emergency path that identifies itself
 * as outside custody conformance and never erases or relabels the
 * uncertainty.
 *
 * So this transition never leaves `unknown`. It attaches the disclosure this
 * install makes to the `unknown` record, keeping every other field, and from
 * then on admits only an exact retry of that same disclosure (the same 15
 * preimages for the same `T`, which reveals nothing new). It never says the
 * key set was disclosed once: another install may have released other keys
 * before, which is exactly what `unknown` keeps saying.
 *
 * Pure: no clock, randomness, storage, or network, and no input is mutated.
 * The same ordering contract as every journal transition applies: the
 * returned journal must be durable before any preimage is released.
 */
import { checkedQsbJournal, type QsbJournalResult, sameQsbDisclosure } from "./qsb-journal";
import { isQsbWriter, type QsbJournalBinding } from "./qsb-journal-record";
import { isQsbVaultRecord, type QsbDisclosure, type QsbVaultRecord } from "./qsb-vault-record";

/**
 * Records `disclosure` on vault `v` of a read-only account, the record staying
 * `unknown`. Only for a bound journal of an account that is not the writer: a
 * writer is refused (`writer-journal`), so the conformant release
 * (`recordQsbExposure`) can never route through here. From `unknown` with a
 * script and funding and no disclosure, the disclosure is attached; from
 * `unknown` with a disclosure, only that exact disclosure is accepted again,
 * returning the journal unchanged (`record-mismatch` otherwise). Every other
 * state, and an `unknown` record without a script or funding, is
 * `state-conflict`; no record for `v` is `unknown-vault`; a disclosure whose
 * `T` does not spend the recorded funding exactly once is `invalid-request`.
 */
export const recordQsbEmergencyExposure = (
  binding: QsbJournalBinding,
  v: number,
  disclosure: QsbDisclosure,
): QsbJournalResult => {
  if (binding.status !== "bound") return { ok: false, refusal: "journal-unavailable" };
  if (isQsbWriter(binding)) return { ok: false, refusal: "writer-journal" };
  const vault = binding.journal.vaults.find((record) => record.v === v);
  if (vault === undefined) return { ok: false, refusal: "unknown-vault" };
  if (vault.state !== "unknown") return { ok: false, refusal: "state-conflict" };
  if (vault.disclosure !== null) {
    return sameQsbDisclosure(vault.disclosure, disclosure)
      ? { journal: binding.journal, ok: true }
      : { ok: false, refusal: "record-mismatch" };
  }
  if (vault.scriptPubKey === null || vault.funding === null) {
    return { ok: false, refusal: "state-conflict" };
  }
  const next: QsbVaultRecord = { ...vault, disclosure };
  if (!isQsbVaultRecord(next)) return { ok: false, refusal: "invalid-request" };
  return checkedQsbJournal(binding.account, {
    ...binding.journal,
    vaults: binding.journal.vaults.map((record) => (record.v === v ? next : record)),
  });
};
