/** Durable exposure, exact retries and input snapshots for the separate PQB protocol. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { FAKE_GENERATED_MNEMONIC_24 } from "@bramble/testkit/fake-kms";
import { isQsbJournal } from "@bramble/vault/qsb-journal-record";
import { readQsbJournal } from "@bramble/vault/qsb-journal-store";
import type { QsbVaultAccess } from "@bramble/vault/service-types";
import type {
  PqbDisclosureRequest,
  PqbPrepared,
  PqbPublicMaterial,
  PqbWitness,
} from "@bramble/wallet-model/pqb";
import { journalIdFor, journalKeyOf, PASSPHRASE, qsbServiceHarness } from "./qsb-service-harness";

const vector = (await Bun.file(
  new URL("../../../../../tests/fixtures/pqb/assembly.json", import.meta.url),
).json()) as {
  readonly prepared: PqbPrepared;
  readonly material: PqbPublicMaterial;
  readonly witness: PqbWitness;
};
const id = journalIdFor("pqb release");
const digest = (r: PqbDisclosureRequest): string =>
  createHash("sha256").update(JSON.stringify(r)).digest("hex");
const fixture = async () => {
  const calls: PqbDisclosureRequest[] = [];
  let atPrepare = async (): Promise<void> => {};
  let atAuthorize = async (): Promise<void> => {};
  const harness = await qsbServiceHarness({
    journalIds: [id],
    kms: {
      pqb: {
        material: async () => vector.material,
        prepare: async (_words, _v, r) => {
          await atPrepare();
          return {
            digest: digest(r),
            cosigSighash: "aa".repeat(32),
            stageSighashes: vector.prepared.sighashes,
          };
        },
        authorize: async (_words, _v, r) => {
          await atAuthorize();
          calls.push(r);
          return vector.witness;
        },
      },
    },
  });
  await harness.service.createQsbAccount(PASSPHRASE);
  const words = FAKE_GENERATED_MNEMONIC_24.split(" ");
  await harness.service.confirmQsbBackup({
    accountId: "qsb-1",
    vaultPassphrase: PASSPHRASE,
    words: [0, 11, 23].map((index) => ({ index, word: words[index] ?? "" })),
  });
  const within = <T>(task: (access: QsbVaultAccess) => Promise<T>) =>
    harness.service.withQsbVaultAccount({ accountId: "qsb-1", vaultPassphrase: PASSPHRASE }, task);
  await within(async (access) => {
    await access.commit({ kind: "allocate", pqb: true, v: 0, root: vector.material.scriptSha256 });
    await access.commit({
      kind: "associate",
      v: 0,
      scriptHash: vector.material.scriptSha256,
      scriptPubKey: vector.material.script,
    });
    await access.commit({
      kind: "fund",
      v: 0,
      funding: { txid: "cc".repeat(32), vout: 1, valueSat: 250000 },
    });
  });
  const stored = async () => {
    const store = harness.journals.forJournal(id);
    if (!store) throw new Error("missing journal fixture");
    const read = await readQsbJournal(store, PASSPHRASE);
    if (read.status !== "present" || !isQsbJournal(read.value))
      throw new Error("invalid journal fixture");
    return read.value.vaults[0];
  };
  const request = (): PqbDisclosureRequest => ({
    transaction: vector.prepared.transaction,
    scriptHash: vector.material.scriptSha256,
    round0: [...vector.prepared.round0],
    round1: [...vector.prepared.round1],
    menus: [...vector.prepared.menus],
  });
  const release = (r = request()) =>
    within(async (access) => {
      if (!access.pqb) throw new Error("missing PQB capability");
      return access.pqb.release(0, r, digest(r), false);
    });
  harness.writes.length = 0;
  return {
    harness,
    calls,
    stored,
    request,
    release,
    atPrepare: (run: () => Promise<void>) => {
      atPrepare = run;
    },
    atAuthorize: (run: () => Promise<void>) => {
      atAuthorize = run;
    },
  };
};
describe("PQB journal-gated authorization", () => {
  test("the exposure is already durable when authorization runs; exact retries write nothing", async () => {
    const f = await fixture();
    f.atAuthorize(async () => {
      expect(await f.stored()).toMatchObject({
        pqb: true,
        state: "exposed",
        disclosure: { menus: vector.prepared.menus },
      });
    });
    expect(await f.release()).toEqual(vector.witness);
    f.harness.writes.length = 0;
    expect(await f.release()).toEqual(vector.witness);
    expect(f.harness.writes).toEqual([]);
    const changed = { ...f.request(), menus: [0, 0, 0] };
    await expect(f.release(changed)).rejects.toThrow();
    expect(f.calls).toHaveLength(2);
  });
  test("a failed durable write authorizes nothing", async () => {
    const f = await fixture();
    f.harness.failWritesTo(journalKeyOf(id));
    await expect(f.release()).rejects.toThrow();
    expect(f.calls).toEqual([]);
    f.harness.failWritesTo(null);
    expect((await f.stored())?.state).toBe("allocated");
  });
  test("caller mutation during preparation cannot change what was journaled or authorized", async () => {
    const f = await fixture(),
      r = f.request();
    const entered = Promise.withResolvers<void>(),
      resume = Promise.withResolvers<void>();
    f.atPrepare(async () => {
      entered.resolve();
      await resume.promise;
    });
    const pending = f.release(r);
    await entered.promise;
    Object.assign(r, { transaction: "00", menus: [0, 0, 0] });
    resume.resolve();
    await pending;
    expect(f.calls[0]?.transaction).toBe(vector.prepared.transaction);
    expect(f.calls[0]?.menus).toEqual(vector.prepared.menus);
    expect((await f.stored())?.disclosure?.transaction).toBe(vector.prepared.transaction);
  });
});
