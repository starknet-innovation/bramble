/**
 * The emergency path of the QSB session through the real vault service: a
 * read-only (imported) account whose recovered deposit is `unknown`. Its
 * release attaches the disclosure to the `unknown` record, durably, before
 * Krusty reveals anything, and the record stays `unknown`; it releases only
 * as an emergency (a conformant request is refused), retries only exactly,
 * and refuses an unfunded deposit — every refusal releasing and writing
 * nothing. A recovered withdrawal is adopted once, never by the writer. The
 * owner key signs a read-only account's helper, and its signed bytes are
 * kept, only once that emergency release is recorded.
 */
import { describe, expect, test } from "bun:test";
import { FAKE_GENERATED_MNEMONIC_24, fakeKms } from "@bramble/testkit/fake-kms";
import type { QsbJournal } from "@bramble/vault/qsb-journal-record";
import { readQsbJournal } from "@bramble/vault/qsb-journal-store";
import type { QsbFunding, QsbVaultRecord } from "@bramble/vault/qsb-vault-record";
import type { QsbVaultAccess } from "@bramble/vault/service-types";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import {
  FUNDING_TXID,
  intent,
  ROUND0,
  ROUND1,
  request,
  transaction,
  words,
} from "./qsb-release-fixtures";
import { journalIdFor, journalKeyOf, PASSPHRASE, qsbServiceHarness } from "./qsb-service-harness";

const JOURNAL = journalIdFor("vault emergency");
const FUNDING: QsbFunding = { txid: FUNDING_TXID, valueSat: 100_000, vout: 0 };
const SCRIPT_HASH = "cd".repeat(32);
const SCRIPT = "51".repeat(100);
const emergency = (fields: Parameters<typeof request>[0] = {}) =>
  request({ emergency: true, ...fields });

// A read-only account holding the harness phrase, whose deposit 0 was
// recovered as `unknown` (`funded` false: before its funding was verified).
const recoveredHarness = async (options: { readonly funded?: boolean } = {}) => {
  const reveals: string[] = [];
  let atReveal: (() => Promise<void>) | undefined;
  const kms = fakeKms();
  const signed: (readonly number[])[] = [];
  const harness = await qsbServiceHarness({
    journalIds: [JOURNAL],
    kms: {
      async revealQsbPreimages(mnemonic, v, round0, round1) {
        await atReveal?.();
        reveals.push(`${v}:${round0.join()}|${round1.join()}`);
        return kms.revealQsbPreimages(mnemonic, v, round0, round1);
      },
      async signBitcoinPsbtInputs(_key, psbt, indices) {
        signed.push(indices);
        return psbt;
      },
    },
  });
  await harness.service.importQsbAccount({
    mnemonic: FAKE_GENERATED_MNEMONIC_24,
    vaultPassphrase: PASSPHRASE,
  });
  const within = <T>(task: (access: QsbVaultAccess) => Promise<T>) =>
    harness.service.withQsbVaultAccount({ accountId: "qsb-1", vaultPassphrase: PASSPHRASE }, task);
  await within(async (access) => {
    const { root } = await access.commitments(0);
    const record: QsbVaultRecord = {
      disclosure: null,
      funding: options.funded === false ? null : FUNDING,
      root,
      scriptHash: SCRIPT_HASH,
      scriptPubKey: SCRIPT,
      state: "unknown",
      v: 0,
    };
    const result = await access.commit({
      journal: { nextV: 1, vaults: [record] },
      kind: "recover",
    });
    if (!result.ok) throw new Error(`recovery refused: ${result.refusal}`);
  });
  harness.writes.length = 0;
  const stored = async (): Promise<QsbVaultRecord | string | undefined> => {
    const read = await readQsbJournal(
      harness.journals.forJournal(JOURNAL) ?? (undefined as never),
      PASSPHRASE,
    );
    return read.status === "present" ? (read.value as QsbJournal).vaults[0] : read.status;
  };
  return {
    harness,
    onReveal: (run: () => Promise<void>) => {
      atReveal = run;
    },
    reveals,
    signed,
    stored,
    within,
  };
};

describe("the emergency release", () => {
  test("attaches the disclosure durably, leaving the deposit unknown, before any reveal", async () => {
    const { onReveal, reveals, stored, within } = await recoveredHarness();
    const seen: unknown[] = [];
    onReveal(async () => {
      seen.push(await stored());
    });
    const asked = await emergency();
    const preimages = await within((access) => access.releasePreimages(asked));
    expect(seen).toEqual([
      expect.objectContaining({
        disclosure: {
          digest: asked.digest,
          round0: ROUND0,
          round1: ROUND1,
          transaction: asked.transaction,
        },
        state: "unknown",
      }),
    ]);
    expect(reveals).toEqual([`0:${ROUND0.join()}|${ROUND1.join()}`]);
    expect(preimages).toHaveLength(15);
  });

  test("a conformant request from a read-only account releases and writes nothing", async () => {
    const { harness, reveals, stored, within } = await recoveredHarness();
    await expect(
      within(async (access) => access.releasePreimages(await request())),
    ).rejects.toThrow(QSB_VAULT_REFUSALS.notWriter);
    expect([reveals, harness.writes]).toEqual([[], []]);
    expect(await stored()).toMatchObject({ disclosure: null, state: "unknown" });
  });

  test("a digest other than the reviewed one releases and writes nothing", async () => {
    const { harness, reveals, within } = await recoveredHarness();
    await expect(
      within(async (access) =>
        access.releasePreimages({ ...(await emergency()), digest: "00".repeat(32) }),
      ),
    ).rejects.toThrow(QSB_WITHDRAWAL_REFUSALS.reviewChanged);
    expect([reveals, harness.writes]).toEqual([[], []]);
  });

  test("an unfunded deposit releases and writes nothing", async () => {
    const { harness, reveals, within } = await recoveredHarness({ funded: false });
    await expect(
      within(async (access) => access.releasePreimages(await emergency())),
    ).rejects.toThrow(QSB_WITHDRAWAL_REFUSALS.bindingRefused);
    expect([reveals, harness.writes]).toEqual([[], []]);
  });

  test("the disclosure cannot be written: nothing is released", async () => {
    const { harness, reveals, stored, within } = await recoveredHarness();
    harness.failWritesTo(journalKeyOf(JOURNAL));
    await expect(
      within(async (access) => access.releasePreimages(await emergency())),
    ).rejects.toThrow();
    harness.failWritesTo(null);
    expect(reveals).toEqual([]);
    expect(await stored()).toMatchObject({ disclosure: null, state: "unknown" });
  });

  test("retries only exactly: the same 15 again without a write, anything else refused", async () => {
    const { harness, reveals, within } = await recoveredHarness();
    const first = await within(async (access) => access.releasePreimages(await emergency()));
    harness.writes.length = 0;
    const again = await within(async (access) => access.releasePreimages(await emergency()));
    expect(again).toEqual(first);
    expect(harness.writes).toEqual([]);
    await expect(
      within(async (access) =>
        access.releasePreimages(await emergency({ transaction: transaction(91_999) })),
      ),
    ).rejects.toThrow(QSB_WITHDRAWAL_REFUSALS.bindingRefused);
    expect(reveals).toHaveLength(2);
  });
});

describe("a recovered withdrawal", () => {
  const adopted = intent({ jobCreated: true });

  test("is adopted once: the same again changes nothing, another is refused", async () => {
    const { harness, within } = await recoveredHarness();
    await within((access) => access.adoptWithdrawal(adopted));
    expect(await within((access) => access.withdrawals())).toEqual([adopted]);
    harness.writes.length = 0;
    await within((access) => access.adoptWithdrawal(adopted));
    expect(harness.writes).toEqual([]);
    await expect(
      within((access) => access.adoptWithdrawal({ ...adopted, manifestHash: "ee".repeat(32) })),
    ).rejects.toThrow(QSB_WITHDRAWAL_REFUSALS.notWithdrawable);
  });

  test("is refused unfunded, unstarted, already signed, or after a disclosure", async () => {
    const unfunded = await recoveredHarness({ funded: false });
    await expect(unfunded.within((access) => access.adoptWithdrawal(adopted))).rejects.toThrow(
      QSB_WITHDRAWAL_REFUSALS.notWithdrawable,
    );
    const { within } = await recoveredHarness();
    for (const record of [
      { ...adopted, jobCreated: false },
      { ...adopted, outcome: "refused" as const },
    ]) {
      await expect(within((access) => access.adoptWithdrawal(record))).rejects.toThrow(
        QSB_WITHDRAWAL_REFUSALS.notWithdrawable,
      );
    }
    await within(async (access) => access.releasePreimages(await emergency()));
    await expect(within((access) => access.adoptWithdrawal(adopted))).rejects.toThrow(
      QSB_WITHDRAWAL_REFUSALS.notWithdrawable,
    );
  });

  test("is never adopted by the writer", async () => {
    const harness = await qsbServiceHarness({ journalIds: [journalIdFor("writer adopt")] });
    await harness.service.createQsbAccount(PASSPHRASE);
    await harness.service.confirmQsbBackup({
      accountId: "qsb-1",
      vaultPassphrase: PASSPHRASE,
      words: [0, 11, 23].map((index) => ({ index, word: words[index] ?? "" })),
    });
    await expect(
      harness.service.withQsbVaultAccount(
        { accountId: "qsb-1", vaultPassphrase: PASSPHRASE },
        (access) => access.adoptWithdrawal(adopted),
      ),
    ).rejects.toThrow(QSB_VAULT_REFUSALS.recoveryNotNeeded);
  });

  test("is signed and its bytes kept only once the emergency release is recorded", async () => {
    const { signed, within } = await recoveredHarness();
    const bytes = { rawTxHex: "0100".padEnd(400, "0"), txid: "dd".repeat(32) };
    const psbt = Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff]);
    await within((access) => access.adoptWithdrawal(adopted));
    await expect(within((access) => access.signWithdrawal(0, psbt))).rejects.toThrow(
      QSB_VAULT_REFUSALS.notWriter,
    );
    await expect(within((access) => access.keepSignedWithdrawal(0, bytes))).rejects.toThrow(
      QSB_VAULT_REFUSALS.notWriter,
    );
    expect(signed).toEqual([]);
    await within(async (access) => access.releasePreimages(await emergency()));
    await within((access) => access.signWithdrawal(0, psbt));
    await within((access) => access.keepSignedWithdrawal(0, bytes));
    await within((access) => access.recordWithdrawalOutcome(0, "submitted"));
    expect(signed).toEqual([[0]]);
    expect((await within((access) => access.withdrawals()))?.[0]).toMatchObject({
      jobCreated: true,
      outcome: "submitted",
      signed: bytes,
    });
  });
});

describe("recovering into the journal", () => {
  test("merges unknown records and writes nothing when run again", async () => {
    const { harness, stored, within } = await recoveredHarness();
    const record = await stored();
    await within(async (access) => {
      const result = await access.commit({
        journal: { nextV: 1, vaults: [record as QsbVaultRecord] },
        kind: "recover",
      });
      expect(result.ok).toBe(true);
    });
    expect(harness.writes).toEqual([]);
  });

  test("is refused for the writer", async () => {
    const harness = await qsbServiceHarness({ journalIds: [journalIdFor("writer recover")] });
    await harness.service.createQsbAccount(PASSPHRASE);
    const result = await harness.service.withQsbVaultAccount(
      { accountId: "qsb-1", vaultPassphrase: PASSPHRASE },
      async (access) => {
        const { root } = await access.commitments(0);
        return access.commit({
          journal: {
            nextV: 1,
            vaults: [
              {
                disclosure: null,
                funding: null,
                root,
                scriptHash: null,
                scriptPubKey: null,
                state: "unknown",
                v: 0,
              },
            ],
          },
          kind: "recover",
        });
      },
    );
    expect(result).toEqual({ ok: false, refusal: "writer-journal" });
  });
});
