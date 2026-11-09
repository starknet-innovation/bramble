/**
 * The emergency disclosure (BIP "QSB Wallet Secret Management", "Backup,
 * restoration, and multiple devices"): only a read-only account's bound
 * journal, only from an `unknown` record with a script and funding, and the
 * record stays `unknown` — the uncertainty is never erased or relabelled. Once
 * attached, only that exact disclosure is accepted again. The writer is
 * refused outright, so the conformant release can never route through here,
 * and the journal it returns still binds to the imported account.
 */
import { describe, expect, test } from "bun:test";
import { recordQsbEmergencyExposure } from "@bramble/vault/qsb-journal-emergency";
import { bindQsbJournal, type QsbJournalBinding } from "@bramble/vault/qsb-journal-record";
import type { QsbVaultRecord } from "@bramble/vault/qsb-vault-record";
import {
  bindingTransaction,
  bound,
  DISCLOSURE,
  FEE_OUTPOINT,
  FUNDING,
  fundedVault,
  importedAccount,
  journalFor,
  P2TR,
  writerAccount,
} from "./qsb-fixtures";

// A recovered deposit: scripted, funded, history unknown, nothing disclosed.
const recovered = (v = 0): QsbVaultRecord => ({ ...fundedVault(v), state: "unknown" });

const readOnly = (vaults: readonly QsbVaultRecord[]): QsbJournalBinding =>
  bound(importedAccount(), vaults);

// The disclosure attached, read back through the account's own binding.
const attached = (binding: QsbJournalBinding) => {
  const result = recordQsbEmergencyExposure(binding, 0, DISCLOSURE);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  const again = bindQsbJournal(importedAccount(), { status: "present", value: result.journal });
  if (again.status !== "bound") throw new Error(`unbound: ${again.reason}`);
  return again;
};

describe("the emergency disclosure", () => {
  test("attaches the disclosure to an unknown record, which stays unknown", () => {
    const binding = attached(readOnly([recovered(0)]));
    expect(binding.journal.vaults[0]).toEqual({ ...recovered(0), disclosure: DISCLOSURE });
    expect(binding.journal.vaults[0]?.state).toBe("unknown");
  });

  test("accepts only an exact retry afterwards, returning the same journal", () => {
    const binding = attached(readOnly([recovered(0)]));
    const retry = recordQsbEmergencyExposure(binding, 0, { ...DISCLOSURE });
    expect(retry.ok && retry.journal).toBe(binding.status === "bound" && binding.journal);
    const reordered = {
      ...DISCLOSURE,
      round0: [DISCLOSURE.round0[1] ?? 0, DISCLOSURE.round0[0] ?? 0, ...DISCLOSURE.round0.slice(2)],
    };
    const otherT = {
      ...DISCLOSURE,
      transaction: bindingTransaction([FUNDING, FEE_OUTPOINT], [{ script: P2TR, valueSat: 1 }]),
    };
    for (const disclosure of [reordered, otherT, { ...DISCLOSURE, digest: "00".repeat(32) }]) {
      expect(recordQsbEmergencyExposure(binding, 0, disclosure)).toEqual({
        ok: false,
        refusal: "record-mismatch",
      });
    }
  });

  test("refuses the writer, so the conformant path never routes through it", () => {
    for (const state of ["allocated", "unknown"] as const) {
      expect(
        recordQsbEmergencyExposure(
          bound(writerAccount(), [{ ...fundedVault(0), state }]),
          0,
          DISCLOSURE,
        ),
      ).toEqual({ ok: false, refusal: "writer-journal" });
    }
  });

  test("refuses every state but unknown", () => {
    for (const state of ["allocated", "exposed", "retired"] as const) {
      const vault =
        state === "exposed"
          ? { ...fundedVault(0), disclosure: DISCLOSURE, state }
          : { ...fundedVault(0), state };
      // An imported journal binds only unknown and retired records, so the
      // others are handed over as a bound pair directly.
      const binding: QsbJournalBinding = {
        account: importedAccount(),
        journal: journalFor(importedAccount(), [vault]),
        status: "bound",
      };
      expect(recordQsbEmergencyExposure(binding, 0, DISCLOSURE)).toEqual({
        ok: false,
        refusal: "state-conflict",
      });
    }
  });

  test("refuses an unknown record without its script or its funding", () => {
    const unscripted: QsbVaultRecord = {
      ...recovered(0),
      funding: null,
      scriptHash: null,
      scriptPubKey: null,
    };
    for (const vault of [{ ...recovered(0), funding: null }, unscripted]) {
      expect(recordQsbEmergencyExposure(readOnly([vault]), 0, DISCLOSURE)).toEqual({
        ok: false,
        refusal: "state-conflict",
      });
    }
  });

  test("refuses a disclosure that does not spend the recorded funding exactly once", () => {
    const elsewhere = {
      ...DISCLOSURE,
      transaction: bindingTransaction([FEE_OUTPOINT], [{ script: P2TR, valueSat: 1 }]),
    };
    expect(recordQsbEmergencyExposure(readOnly([recovered(0)]), 0, elsewhere)).toEqual({
      ok: false,
      refusal: "invalid-request",
    });
  });

  test("refuses a missing record and an unbound journal", () => {
    expect(recordQsbEmergencyExposure(readOnly([recovered(0)]), 1, DISCLOSURE)).toEqual({
      ok: false,
      refusal: "unknown-vault",
    });
    expect(
      recordQsbEmergencyExposure(
        { account: importedAccount(), reason: "missing", status: "unavailable" },
        0,
        DISCLOSURE,
      ),
    ).toEqual({ ok: false, refusal: "journal-unavailable" });
  });
});
