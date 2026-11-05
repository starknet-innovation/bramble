/**
 * The QSB session's withdrawal methods through the real vault service. The
 * release is the one call that reveals preimages, and only after the
 * `exposed` record is durable: Krusty's reveal sees the exposure already in
 * storage, a failed journal write or a digest that is not the reviewed one
 * releases nothing, an exact retry releases the same 15 again without a
 * write, and any other `T` or index order is refused once exposed. Intents
 * and signed bytes are kept once, never replaced, with distinct helpers.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { FAKE_GENERATED_MNEMONIC_24, fakeKms } from "@bramble/testkit/fake-kms";
import type { QsbJournal } from "@bramble/vault/qsb-journal-record";
import { readQsbJournal } from "@bramble/vault/qsb-journal-store";
import type { QsbWithdrawalRecord } from "@bramble/vault/qsb-withdrawal-store";
import type { QsbReleaseRequest, QsbVaultAccess } from "@bramble/vault/service-types";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import { journalIdFor, journalKeyOf, PASSPHRASE, qsbServiceHarness } from "./qsb-service-harness";

const JOURNAL = journalIdFor("vault withdrawals");
const WITHDRAWAL_KEY = `bramble:qsb-withdrawal:${JOURNAL}`;
const words = FAKE_GENERATED_MNEMONIC_24.split(" ");
const FUNDING_TXID = "aa".repeat(32);
const HELPER_TXID = "bb".repeat(32);
const ROUND0 = [5, 55, 66, 72, 75, 78, 110, 125];
const ROUND1 = [14, 28, 65, 81, 87, 95, 128];

const le = (hex: string): string => hex.match(/../g)?.reverse().join("") ?? "";

// T: version 1, the helper then the funding, one P2WPKH output, a locktime.
const transaction = (outputSat = 92_000, locktime = 950_229_240): string =>
  [
    "01000000",
    "02",
    le(HELPER_TXID),
    "01000000",
    "00",
    "feffffff",
    le(FUNDING_TXID),
    "00000000",
    "00",
    "a1070080",
    "01",
    le(outputSat.toString(16).padStart(16, "0")),
    "16",
    `0014${"33".repeat(20)}`,
    le(locktime.toString(16).padStart(8, "0")),
  ].join("");

const digestOf = async (t: string, round0 = ROUND0, round1 = ROUND1) =>
  (await fakeKms().qsbRevealDigest(t, round0, round1)).digest;

const request = async (fields: Partial<QsbReleaseRequest> = {}): Promise<QsbReleaseRequest> => {
  const t = fields.transaction ?? transaction();
  return {
    digest: await digestOf(t, [...(fields.round0 ?? ROUND0)], [...(fields.round1 ?? ROUND1)]),
    round0: ROUND0,
    round1: ROUND1,
    transaction: t,
    v: 0,
    ...fields,
  };
};

const intent = (fields: Partial<QsbWithdrawalRecord> = {}): QsbWithdrawalRecord => ({
  destination: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  feeSat: 9_449,
  helper: { txid: HELPER_TXID, valueSat: 1_449, vout: 1 },
  jobCreated: false,
  jobId: "0b8f7f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
  manifestHash: createHash("sha256").update("manifest").digest("hex"),
  manifestJson: '{"vaultId":"x"}',
  outcome: null,
  outputSat: 92_000,
  signed: null,
  v: 0,
  ...fields,
});

// A writer whose vault 0 is allocated, scripted and funded; `reveals` counts reveals.
const fundedHarness = async () => {
  const reveals: string[] = [];
  let atReveal: (() => Promise<void>) | undefined;
  const kms = fakeKms();
  const harness = await qsbServiceHarness({
    journalIds: [JOURNAL],
    kms: {
      async revealQsbPreimages(mnemonic, v, round0, round1) {
        await atReveal?.();
        reveals.push(`${v}:${round0.join()}|${round1.join()}`);
        return kms.revealQsbPreimages(mnemonic, v, round0, round1);
      },
    },
  });
  await harness.service.createQsbAccount(PASSPHRASE);
  await harness.service.confirmQsbBackup({
    accountId: "qsb-1",
    vaultPassphrase: PASSPHRASE,
    words: [0, 11, 23].map((index) => ({ index, word: words[index] ?? "" })),
  });
  const within = <T>(task: (access: QsbVaultAccess) => Promise<T>) =>
    harness.service.withQsbVaultAccount({ accountId: "qsb-1", vaultPassphrase: PASSPHRASE }, task);
  await within(async (access) => {
    const { root } = await access.commitments(0);
    await access.commit({ kind: "allocate", root, v: 0 });
    await access.commit({
      kind: "associate",
      scriptHash: "cd".repeat(32),
      scriptPubKey: "51".repeat(100),
      v: 0,
    });
    await access.commit({
      funding: { txid: FUNDING_TXID, valueSat: 100_000, vout: 0 },
      kind: "fund",
      v: 0,
    });
  });
  harness.writes.length = 0;
  // The state vault 0 has in storage right now, read past the service's queue.
  const storedState = async () => {
    const read = await readQsbJournal(
      harness.journals.forJournal(JOURNAL) ?? (undefined as never),
      PASSPHRASE,
    );
    return read.status === "present" ? (read.value as QsbJournal).vaults[0]?.state : read.status;
  };
  return {
    harness,
    onReveal: (run: () => Promise<void>) => {
      atReveal = run;
    },
    reveals,
    storedState,
    within,
  };
};

describe("the release", () => {
  test("records the exposure durably before Krusty reveals anything", async () => {
    const { onReveal, reveals, storedState, within } = await fundedHarness();
    const seen: unknown[] = [];
    onReveal(async () => {
      seen.push(await storedState());
    });
    const preimages = await within(async (access) => access.releasePreimages(await request()));
    expect(seen).toEqual(["exposed"]);
    expect(reveals).toEqual([`0:${ROUND0.join()}|${ROUND1.join()}`]);
    expect(preimages).toHaveLength(15);
  });

  test("releases nothing when the exposure cannot be written", async () => {
    const { harness, reveals, storedState, within } = await fundedHarness();
    harness.failWritesTo(journalKeyOf(JOURNAL));
    await expect(
      within(async (access) => access.releasePreimages(await request())),
    ).rejects.toThrow();
    harness.failWritesTo(null);
    expect(reveals).toEqual([]);
    expect(await storedState()).toBe("allocated");
  });

  test("releases nothing for a digest other than the reviewed one", async () => {
    const { harness, reveals, within } = await fundedHarness();
    await expect(
      within(async (access) =>
        access.releasePreimages({ ...(await request()), digest: "00".repeat(32) }),
      ),
    ).rejects.toThrow(QSB_WITHDRAWAL_REFUSALS.reviewChanged);
    expect([reveals, harness.writes]).toEqual([[], []]);
  });

  test("an exact retry releases the same 15 again, writing nothing", async () => {
    const { harness, reveals, within } = await fundedHarness();
    const first = await within(async (access) => access.releasePreimages(await request()));
    harness.writes.length = 0;
    const again = await within(async (access) => access.releasePreimages(await request()));
    expect(again).toEqual(first);
    expect(harness.writes).toEqual([]);
    expect(reveals).toHaveLength(2);
  });

  test("once exposed, another T or another index order is refused", async () => {
    const { reveals, within } = await fundedHarness();
    await within(async (access) => access.releasePreimages(await request()));
    const reordered = [ROUND0[1] ?? 0, ROUND0[0] ?? 0, ...ROUND0.slice(2)];
    for (const fields of [
      { transaction: transaction(91_999) },
      { round0: reordered },
      { transaction: transaction(92_000, 950_229_241) },
    ]) {
      await expect(
        within(async (access) => access.releasePreimages(await request(fields))),
      ).rejects.toThrow(QSB_WITHDRAWAL_REFUSALS.bindingRefused);
    }
    expect(reveals).toHaveLength(1);
  });

  test("an unfunded vault releases nothing", async () => {
    const { harness, reveals, within } = await fundedHarness();
    await within(async (access) => {
      const { root } = await access.commitments(1);
      await access.commit({ kind: "allocate", root, v: 1 });
    });
    harness.writes.length = 0;
    await expect(
      within(async (access) => access.releasePreimages(await request({ v: 1 }))),
    ).rejects.toThrow(QSB_WITHDRAWAL_REFUSALS.bindingRefused);
    expect([reveals, harness.writes]).toEqual([[], []]);
  });

  test("an unknown vault releases nothing", async () => {
    const { reveals, within } = await fundedHarness();
    await expect(
      within(async (access) => access.releasePreimages(await request({ v: 7 }))),
    ).rejects.toThrow(QSB_VAULT_REFUSALS.unknownVault);
    expect(reveals).toEqual([]);
  });
});

describe("the withdrawal record", () => {
  test("keeps an intent once, in its own key, and never another for the vault", async () => {
    const { harness, within } = await fundedHarness();
    await within((access) => access.holdWithdrawal(intent()));
    expect(
      harness.writes.filter((key) => !key.includes(":commit:") && !key.endsWith(":legacy")),
    ).toEqual([WITHDRAWAL_KEY]);
    harness.writes.length = 0;
    await within((access) => access.holdWithdrawal(intent()));
    expect(harness.writes).toEqual([]);
    await expect(
      within((access) =>
        access.holdWithdrawal(intent({ feeSat: 9_450, manifestHash: "ee".repeat(32) })),
      ),
    ).rejects.toThrow(QSB_WITHDRAWAL_REFUSALS.notWithdrawable);
    expect(await within((access) => access.withdrawals())).toEqual([intent()]);
  });

  test("refuses an unfunded vault and a helper another withdrawal holds", async () => {
    const { within } = await fundedHarness();
    await within(async (access) => {
      const { root } = await access.commitments(1);
      await access.commit({ kind: "allocate", root, v: 1 });
      await access.commit({
        kind: "associate",
        scriptHash: "ce".repeat(32),
        scriptPubKey: "52".repeat(100),
        v: 1,
      });
    });
    await expect(within((access) => access.holdWithdrawal(intent({ v: 1 })))).rejects.toThrow(
      QSB_WITHDRAWAL_REFUSALS.notWithdrawable,
    );
    await within((access) => access.holdWithdrawal(intent()));
    await within((access) =>
      access.commit({
        funding: { txid: "cc".repeat(32), valueSat: 50_000, vout: 0 },
        kind: "fund",
        v: 1,
      }),
    );
    await expect(
      within((access) =>
        access.holdWithdrawal(
          intent({
            jobId: "1b8f7f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
            manifestHash: "ef".repeat(32),
            v: 1,
          }),
        ),
      ),
    ).rejects.toThrow(QSB_WITHDRAWAL_REFUSALS.helperNeeded);
  });

  test("keeps signed bytes only once exposed, and never other bytes", async () => {
    const { within } = await fundedHarness();
    const signed = { rawTxHex: "0100".padEnd(400, "0"), txid: "dd".repeat(32) };
    await within((access) => access.holdWithdrawal(intent()));
    await expect(within((access) => access.keepSignedWithdrawal(0, signed))).rejects.toThrow(
      QSB_WITHDRAWAL_REFUSALS.notReady,
    );
    await within(async (access) => access.releasePreimages(await request()));
    await within((access) => access.keepSignedWithdrawal(0, signed));
    await within((access) => access.keepSignedWithdrawal(0, signed));
    await expect(
      within((access) =>
        access.keepSignedWithdrawal(0, { ...signed, rawTxHex: "0200".padEnd(400, "0") }),
      ),
    ).rejects.toThrow(QSB_WITHDRAWAL_REFUSALS.bindingRefused);
    await within((access) => access.recordWithdrawalOutcome(0, "submitted"));
    expect((await within((access) => access.withdrawals()))?.[0]).toMatchObject({
      outcome: "submitted",
      signed,
    });
  });

  test("the helper is signed at input 0 only", async () => {
    const indices: (readonly number[])[] = [];
    const harness = await qsbServiceHarness({
      journalIds: [journalIdFor("signing")],
      kms: {
        async signBitcoinPsbtInputs(_key, psbt, inputIndices) {
          indices.push(inputIndices);
          return psbt;
        },
      },
    });
    await harness.service.createQsbAccount(PASSPHRASE);
    await harness.service.withQsbVaultAccount(
      { accountId: "qsb-1", vaultPassphrase: PASSPHRASE },
      (access) => access.signWithdrawal(Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff])),
    );
    expect(indices).toEqual([[0]]);
  });
});
