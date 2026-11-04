/**
 * Creating and importing QSB accounts through the real vault service: the
 * phrase comes from Krusty (24 words, checked by Krusty) or from the user (in
 * its canonical spelling, dedicated, and never a writer); the empty journal is
 * written before the vault; a failure stops at the first write that failed and
 * leaves at most an orphan journal nothing reads; and every refusal is one of
 * the shared QSB diagnostics.
 */
import { describe, expect, test } from "bun:test";
import { FAKE_GENERATED_MNEMONIC_24 } from "@bramble/testkit/fake-kms";
import type { QsbAccountRecord } from "@bramble/vault/qsb-account";
import { emptyQsbJournal } from "@bramble/vault/qsb-journal-record";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { PHRASE_A, PHRASE_B, PHRASE_C } from "../qsb/qsb-fixtures";
import {
  journalIdFor,
  journalKeyOf,
  PASSPHRASE,
  qsbServiceHarness,
  starknetVault,
  VAULT_KEY,
} from "./qsb-service-harness";
import { capacity, vaultWith } from "./vault-fixture";

const JOURNAL_1 = journalIdFor("one");
const JOURNAL_2 = journalIdFor("two");

// A held account, as a vault that already has one stores it.
const heldAccount = (index: number, mnemonic: string): QsbAccountRecord => ({
  backupConfirmed: true,
  id: `qsb-${index}`,
  journalId: journalIdFor(`held ${index}`),
  mnemonic,
  network: "bitcoin-mainnet",
  seedContext: { provenance: "generated-here", source: "bip39" },
});

// Eight distinct 24-word phrases (the fake Krusty accepts any of them).
const EIGHT_PHRASES = [
  PHRASE_A,
  PHRASE_B,
  PHRASE_C,
  ...["ability", "able", "about", "above", "absent"].map(
    (last) => `${"abandon ".repeat(23)}${last}`,
  ),
];

describe("creating a QSB account", () => {
  test("asks Krusty for 24 words and stores a generated, unconfirmed account", async () => {
    const harness = await qsbServiceHarness({ journalIds: [JOURNAL_1] });
    const view = await harness.service.createQsbAccount(PASSPHRASE);

    expect(view).toEqual({
      backupConfirmed: false,
      id: "qsb-1",
      journal: "bound",
      provenance: "generated-here",
      writer: false,
    });
    expect(harness.generated).toEqual([24]);
    expect(await harness.storedQsbAccounts()).toEqual([
      {
        backupConfirmed: false,
        id: "qsb-1",
        journalId: JOURNAL_1,
        mnemonic: FAKE_GENERATED_MNEMONIC_24,
        network: "bitcoin-mainnet",
        seedContext: { provenance: "generated-here", source: "bip39" },
      },
    ]);
    const journal = harness.journals.forJournal(JOURNAL_1);
    expect(await journal?.read(PASSPHRASE)).toEqual(
      emptyQsbJournal({ id: "qsb-1", journalId: JOURNAL_1 }),
    );
    // The view is the whole reply: no phrase, no journal id.
    expect(JSON.stringify(view)).not.toContain(FAKE_GENERATED_MNEMONIC_24);
    expect(JSON.stringify(view)).not.toContain(JOURNAL_1);
  });

  test("writes the empty journal before the vault that names it", async () => {
    const harness = await qsbServiceHarness({ journalIds: [JOURNAL_1] });
    await harness.service.createQsbAccount(PASSPHRASE);
    const envelopes = harness.writes.filter(
      (key) => key === journalKeyOf(JOURNAL_1) || key === VAULT_KEY,
    );
    expect(envelopes).toEqual([journalKeyOf(JOURNAL_1), VAULT_KEY]);
  });

  test("a failed vault write leaves an orphan journal and no account; a retry draws afresh", async () => {
    const harness = await qsbServiceHarness({ journalIds: [JOURNAL_1, JOURNAL_2] });
    harness.failWritesTo(VAULT_KEY);
    await expect(harness.service.createQsbAccount(PASSPHRASE)).rejects.toThrow(
      QSB_ACCOUNT_REFUSALS.creationFailed,
    );
    harness.failWritesTo(null);
    expect(await harness.backend.get(journalKeyOf(JOURNAL_1))).toBeDefined();
    expect(await harness.storedQsbAccounts()).toEqual([]);
    expect(await harness.service.qsbAccounts(PASSPHRASE)).toEqual([]);

    const retried = await harness.service.createQsbAccount(PASSPHRASE);
    expect(retried.id).toBe("qsb-1");
    expect((await harness.storedQsbAccounts()).map((account) => account.journalId)).toEqual([
      JOURNAL_2,
    ]);
  });

  test("a failed journal write stops before the vault is touched", async () => {
    const harness = await qsbServiceHarness({ journalIds: [JOURNAL_1] });
    harness.failWritesTo(journalKeyOf(JOURNAL_1));
    await expect(harness.service.createQsbAccount(PASSPHRASE)).rejects.toThrow(
      QSB_ACCOUNT_REFUSALS.creationFailed,
    );
    expect(harness.writes).not.toContain(VAULT_KEY);
    expect(await harness.storedQsbAccounts()).toEqual([]);
  });

  test("a vault that cannot take the account refuses before any journal is written", async () => {
    const harness = await qsbServiceHarness({
      journalIds: [JOURNAL_1],
      vault: vaultWith(capacity()),
    });
    await expect(harness.service.createQsbAccount(PASSPHRASE)).rejects.toThrow(
      QSB_ACCOUNT_REFUSALS.creationFailed,
    );
    expect(harness.writes).toEqual([]);
  });

  test("a drawn journal id whose key already holds a journal is never written over", async () => {
    const harness = await qsbServiceHarness({ journalIds: [JOURNAL_1] });
    const orphan = harness.journals.forJournal(JOURNAL_1);
    await orphan?.write({ orphan: true }, PASSPHRASE);
    harness.writes.length = 0;
    await expect(harness.service.createQsbAccount(PASSPHRASE)).rejects.toThrow(
      QSB_ACCOUNT_REFUSALS.creationFailed,
    );
    expect(harness.writes).toEqual([]);
    expect(await orphan?.read(PASSPHRASE)).toEqual({ orphan: true });
  });

  test("refuses at the account limit before asking Krusty for a phrase", async () => {
    const vault = {
      ...starknetVault(),
      qsbAccounts: EIGHT_PHRASES.map((phrase, index) => heldAccount(index + 1, phrase)),
    };
    const harness = await qsbServiceHarness({ vault });
    await expect(harness.service.createQsbAccount(PASSPHRASE)).rejects.toThrow(
      QSB_ACCOUNT_REFUSALS.accountLimit,
    );
    expect(harness.generated).toEqual([]);
    expect(harness.writes).toEqual([]);
  });

  test("fails closed when Krusty is unavailable or answers with anything but a QSB phrase", async () => {
    for (const kms of [
      {
        generateMnemonic: async () => {
          throw new Error("krusty unavailable");
        },
      },
      { generateMnemonic: async () => "habit hope tip crystal because grunt nation idea" },
      { validateMnemonic: async () => false },
      {
        validateMnemonic: async () => {
          throw new Error("krusty unavailable");
        },
      },
    ]) {
      const harness = await qsbServiceHarness({ kms });
      await expect(harness.service.createQsbAccount(PASSPHRASE)).rejects.toThrow(
        QSB_ACCOUNT_REFUSALS.creationFailed,
      );
      expect(harness.writes).toEqual([]);
    }
  });

  test("a wallet without a vault, or without QSB wiring, creates nothing", async () => {
    for (const options of [{ vault: null }, { wired: false }] as const) {
      const harness = await qsbServiceHarness(options);
      await expect(harness.service.createQsbAccount(PASSPHRASE)).rejects.toThrow(
        QSB_ACCOUNT_REFUSALS.creationFailed,
      );
      expect(harness.writes).toEqual([]);
    }
  });
});

describe("importing a QSB account", () => {
  test("stores the canonical spelling, read-only and with its backup confirmed", async () => {
    const harness = await qsbServiceHarness({ journalIds: [JOURNAL_1] });
    const typed = `  ${PHRASE_B.toUpperCase().split(" ").join("  \n ")}\t`;
    const view = await harness.service.importQsbAccount({
      mnemonic: typed,
      vaultPassphrase: PASSPHRASE,
    });

    expect(view).toEqual({
      backupConfirmed: true,
      id: "qsb-1",
      journal: "bound",
      provenance: "imported",
      writer: false,
    });
    expect(await harness.storedQsbAccounts()).toEqual([
      {
        backupConfirmed: true,
        id: "qsb-1",
        journalId: JOURNAL_1,
        mnemonic: PHRASE_B,
        network: "bitcoin-mainnet",
        seedContext: { provenance: "imported", source: "bip39" },
      },
    ]);
    expect(
      harness.writes.filter((key) => key === journalKeyOf(JOURNAL_1) || key === VAULT_KEY),
    ).toEqual([journalKeyOf(JOURNAL_1), VAULT_KEY]);
    expect(harness.generated).toEqual([]);
  });

  test("refuses anything that is not a 24-word phrase Krusty accepts", async () => {
    for (const mnemonic of [
      "habit hope tip crystal because grunt nation idea electric witness alert like",
      PHRASE_A.split(" ").slice(1).join(" "),
      `${PHRASE_A} abandon`,
      PHRASE_A.replace("art", "art1"),
      "",
      "x".repeat(600),
    ]) {
      const harness = await qsbServiceHarness();
      await expect(
        harness.service.importQsbAccount({ mnemonic, vaultPassphrase: PASSPHRASE }),
      ).rejects.toThrow(QSB_ACCOUNT_REFUSALS.invalidPhrase);
      expect(harness.writes).toEqual([]);
    }
    const rejecting = await qsbServiceHarness({ kms: { validateMnemonic: async () => false } });
    await expect(
      rejecting.service.importQsbAccount({ mnemonic: PHRASE_A, vaultPassphrase: PASSPHRASE }),
    ).rejects.toThrow(QSB_ACCOUNT_REFUSALS.invalidPhrase);
  });

  test("refuses a phrase another QSB account already holds, however it is spelled", async () => {
    const harness = await qsbServiceHarness({
      vault: { ...starknetVault(), qsbAccounts: [heldAccount(1, PHRASE_A)] },
    });
    await expect(
      harness.service.importQsbAccount({
        mnemonic: ` ${PHRASE_A.toUpperCase()} `,
        vaultPassphrase: PASSPHRASE,
      }),
    ).rejects.toThrow(QSB_ACCOUNT_REFUSALS.duplicatePhrase);
    expect(harness.writes).toEqual([]);
  });

  test("refuses one of the wallet's Starknet phrases, founding or imported", async () => {
    const founding = await qsbServiceHarness({
      vault: { ...starknetVault(), mnemonic: PHRASE_C },
    });
    await expect(
      founding.service.importQsbAccount({ mnemonic: PHRASE_C, vaultPassphrase: PASSPHRASE }),
    ).rejects.toThrow(QSB_ACCOUNT_REFUSALS.notDedicated);
    const imported = await qsbServiceHarness({
      vault: { ...starknetVault(), importedSeeds: [{ id: "phrase-1", mnemonic: PHRASE_C }] },
    });
    await expect(
      imported.service.importQsbAccount({ mnemonic: PHRASE_C, vaultPassphrase: PASSPHRASE }),
    ).rejects.toThrow(QSB_ACCOUNT_REFUSALS.notDedicated);
    expect([...founding.writes, ...imported.writes]).toEqual([]);
  });

  test("refuses at the account limit, and fails closed without Krusty", async () => {
    const full = await qsbServiceHarness({
      vault: {
        ...starknetVault(),
        qsbAccounts: EIGHT_PHRASES.map((phrase, index) => heldAccount(index + 1, phrase)),
      },
    });
    const fresh = "zoo ".repeat(23).concat("vote");
    await expect(
      full.service.importQsbAccount({ mnemonic: fresh, vaultPassphrase: PASSPHRASE }),
    ).rejects.toThrow(QSB_ACCOUNT_REFUSALS.accountLimit);
    const offline = await qsbServiceHarness({
      kms: {
        validateMnemonic: async () => {
          throw new Error("krusty unavailable");
        },
      },
    });
    await expect(
      offline.service.importQsbAccount({ mnemonic: fresh, vaultPassphrase: PASSPHRASE }),
    ).rejects.toThrow(QSB_ACCOUNT_REFUSALS.creationFailed);
    expect([...full.writes, ...offline.writes]).toEqual([]);
  });
});
