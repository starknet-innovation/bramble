/**
 * The QSB vault session through the real vault service: it opens only over a
 * known account of a wired service, advances the journal durably and never
 * recreates a lost one, keeps pending deposits in their own encrypted key
 * bound to the account, derives the owner key on demand for each use, hands
 * out public data only, runs in the mutation queue, and refuses every call
 * once its task has settled.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { FAKE_BITCOIN_OWNER, FAKE_GENERATED_MNEMONIC_24 } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import {
  QSB_DEPOSIT_STORE_MAX_BYTES,
  QSB_MAX_DEPOSIT_TX_BYTES,
  QSB_MAX_PENDING_DEPOSITS,
  type QsbPendingDeposit,
  qsbPendingRecord,
  readQsbPendingDeposits,
} from "@bramble/vault/qsb-deposit-store";
import type { QsbVaultAccess } from "@bramble/vault/service-types";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { QSB_MAX_SAT, QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { journalIdFor, journalKeyOf, PASSPHRASE, qsbServiceHarness } from "./qsb-service-harness";

const JOURNAL = journalIdFor("vault access");
const depositKey = `bramble:qsb-deposit:${JOURNAL}`;
const words = FAKE_GENERATED_MNEMONIC_24.split(" ");

// The envelope keys written, without their commit records and markers.
const envelopes = (writes: readonly string[]): readonly string[] =>
  writes.filter((key) => !key.includes(":commit:") && !key.endsWith(":legacy"));

const deposit = (v: number, txid = "ab".repeat(32)): QsbPendingDeposit => ({
  amountSat: 50_000,
  rawTxHex: "02000000".padEnd(200, "0"),
  txid,
  v,
});

// A wallet with one confirmed (writer) account over a fresh journal.
const writerHarness = async (options: Parameters<typeof qsbServiceHarness>[0] = {}) => {
  const harness = await qsbServiceHarness({ journalIds: [JOURNAL], ...options });
  await harness.service.createQsbAccount(PASSPHRASE);
  await harness.service.confirmQsbBackup({
    accountId: "qsb-1",
    vaultPassphrase: PASSPHRASE,
    words: [0, 11, 23].map((index) => ({ index, word: words[index] ?? "" })),
  });
  harness.writes.length = 0;
  return harness;
};

const within = <T>(
  harness: Awaited<ReturnType<typeof writerHarness>>,
  task: (access: QsbVaultAccess) => Promise<T>,
  accountId = "qsb-1",
) => harness.service.withQsbVaultAccount({ accountId, vaultPassphrase: PASSPHRASE }, task);

describe("opening a session", () => {
  test("refuses an unknown account and a service without QSB wiring", async () => {
    const harness = await writerHarness();
    await expect(within(harness, async () => 1, "qsb-9")).rejects.toThrow(
      QSB_ACCOUNT_REFUSALS.unknownAccount,
    );
    const unwired = await qsbServiceHarness({ wired: false });
    await expect(
      unwired.service.withQsbVaultAccount(
        { accountId: "qsb-1", vaultPassphrase: PASSPHRASE },
        async () => 1,
      ),
    ).rejects.toThrow(QSB_ACCOUNT_REFUSALS.unknownAccount);
  });

  test("a handle used after its task settles refuses", async () => {
    const harness = await writerHarness();
    const leaked = await within(harness, async (access) => access);
    await expect(leaked.owner()).rejects.toThrow(QSB_VAULT_REFUSALS.runtimeUnavailable);
    await expect(leaked.signSignIn("m")).rejects.toThrow(QSB_VAULT_REFUSALS.runtimeUnavailable);
  });
});

describe("the journal and Krusty", () => {
  test("commits an allocation durably and returns public data only", async () => {
    const harness = await writerHarness();
    const result = await within(harness, async (access) => {
      const commitments = await access.commitments(0);
      return {
        allocated: await access.commit({ kind: "allocate", root: commitments.root, v: 0 }),
        owner: await access.owner(),
        proof: await access.signSignIn("hello"),
      };
    });
    expect(result.allocated.ok).toBe(true);
    expect(envelopes(harness.writes)).toEqual([journalKeyOf(JOURNAL)]);
    expect(result.owner).toEqual({
      address: FAKE_BITCOIN_OWNER.address,
      publicKey: FAKE_BITCOIN_OWNER.publicKey,
    });
    expect(JSON.stringify(result)).not.toContain(FAKE_BITCOIN_OWNER.privateKey);
    expect(JSON.stringify(result)).not.toContain(JOURNAL);
    const journal = await within(harness, (access) => access.journal());
    expect(journal).toMatchObject({ nextV: 1, status: "bound", writer: true });
    expect(JSON.stringify(journal)).not.toContain(JOURNAL);
    expect(JSON.stringify(journal)).not.toContain(words[0] ?? "phrase");
  });

  test("a refused or no-op transition writes nothing; a lost journal is not recreated", async () => {
    const harness = await writerHarness();
    const stale = await within(harness, (access) =>
      access.commit({ kind: "allocate", root: "11".repeat(32), v: 5 }),
    );
    expect(stale).toEqual({ ok: false, refusal: "stale-index" });
    expect(harness.writes).toEqual([]);
    await harness.backend.remove(journalKeyOf(JOURNAL));
    const lost = await within(harness, (access) =>
      access.commit({ kind: "allocate", root: "11".repeat(32), v: 0 }),
    );
    expect(lost).toEqual({ ok: false, refusal: "journal-unavailable" });
    expect(await harness.backend.get(journalKeyOf(JOURNAL))).toBeUndefined();
  });

  test("signs a deposit's inputs 0..n-1 with the owner key, derived for the call", async () => {
    const calls: unknown[][] = [];
    const harness = await writerHarness({
      kms: {
        async signBitcoinPsbtInputs(key: string, psbt: Uint8Array, indices: readonly number[]) {
          calls.push([key, indices]);
          return psbt;
        },
      } as never,
    });
    const psbt = Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff]);
    expect(await within(harness, (access) => access.signDeposit(psbt, 3))).toEqual(psbt);
    expect(calls).toEqual([[FAKE_BITCOIN_OWNER.privateKey, [0, 1, 2]]]);
  });
});

describe("pending deposits", () => {
  test("are kept in their own key, bound to the account, and released by txid only", async () => {
    const harness = await writerHarness();
    expect(await within(harness, (access) => access.pendingDeposits())).toEqual([]);
    await within(harness, (access) => access.holdDeposit(deposit(2)));
    expect(envelopes(harness.writes)).toEqual([depositKey]);
    await within(harness, (access) => access.holdDeposit(deposit(1)));
    expect((await within(harness, (access) => access.pendingDeposits()))?.map((d) => d.v)).toEqual([
      1, 2,
    ]);
    await within(harness, (access) => access.releaseDeposit(2, "cd".repeat(32)));
    expect(await within(harness, (access) => access.pendingDeposits())).toHaveLength(2);
    await within(harness, (access) => access.releaseDeposit(2, "ab".repeat(32)));
    expect(await within(harness, (access) => access.pendingDeposits())).toEqual([deposit(1)]);
    const stored = await readQsbPendingDeposits(
      createEncryptedStore(harness.backend, depositKey),
      { id: "qsb-1", journalId: JOURNAL },
      PASSPHRASE,
    );
    expect(stored).toEqual({ deposits: [deposit(1)], status: "bound" });
  });

  test("refuse a deposit past the cap, and fail closed on a foreign or unreadable record", async () => {
    const harness = await writerHarness();
    for (let v = 0; v < QSB_MAX_PENDING_DEPOSITS; v += 1) {
      await within(harness, (access) => access.holdDeposit(deposit(v)));
    }
    await expect(
      within(harness, (access) => access.holdDeposit(deposit(QSB_MAX_PENDING_DEPOSITS))),
    ).rejects.toThrow(QSB_VAULT_REFUSALS.depositPending);
    const foreign = qsbPendingRecord({ id: "qsb-2", journalId: JOURNAL }, []);
    await createEncryptedStore(harness.backend, depositKey).write(foreign ?? {}, PASSPHRASE);
    expect(await within(harness, (access) => access.pendingDeposits())).toBeNull();
    await expect(within(harness, (access) => access.holdDeposit(deposit(0)))).rejects.toThrow(
      QSB_ACCOUNT_REFUSALS.journalUnavailable,
    );
  });

  test("four of the largest deposits fit the record and the at-rest budget", async () => {
    const largest = (v: number): QsbPendingDeposit => ({
      amountSat: QSB_MAX_SAT,
      rawTxHex: "ff".repeat(QSB_MAX_DEPOSIT_TX_BYTES),
      txid: "cd".repeat(32),
      v: 2 ** 31 - 1 - v,
    });
    const deposits = Array.from({ length: QSB_MAX_PENDING_DEPOSITS }, (_, v) => largest(v));
    const record = qsbPendingRecord({ id: "qsb-8", journalId: JOURNAL }, deposits);
    expect(record).not.toBeNull();
    expect(JSON.stringify(record).length).toBeLessThanOrEqual(QSB_DEPOSIT_STORE_MAX_BYTES);
    await createEncryptedStore(createMemoryStore(), depositKey).write(record ?? {}, PASSPHRASE);
  });

  test("records hold only valid deposits, one per vault", () => {
    const account = { id: "qsb-1", journalId: JOURNAL };
    expect(qsbPendingRecord(account, [deposit(1), deposit(1)])).toBeNull();
    expect(qsbPendingRecord(account, [{ ...deposit(1), amountSat: 0 }])).toBeNull();
    expect(qsbPendingRecord(account, [{ ...deposit(1), rawTxHex: "AB" }])).toBeNull();
    expect(
      qsbPendingRecord(account, [{ ...deposit(1), rawTxHex: "00".repeat(12_001) }]),
    ).toBeNull();
    expect(qsbPendingRecord(account, [deposit(3), deposit(1)])?.deposits.map((d) => d.v)).toEqual([
      1, 3,
    ]);
  });
});

describe("the mutation queue", () => {
  test("a vault write waits for a running session", async () => {
    const harness = await writerHarness();
    const order: string[] = [];
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = within(harness, async () => {
      order.push("session start");
      await gate;
      order.push("session end");
    });
    const listing = harness.service.qsbAccounts(PASSPHRASE).then(() => order.push("listing"));
    await Bun.sleep(5);
    release();
    await Promise.all([session, listing]);
    expect(order).toEqual(["session start", "session end", "listing"]);
  });
});
