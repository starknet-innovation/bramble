/**
 * Creating a QSB vault, refusal by refusal, through the real router, vault
 * service and Krusty: only a writer creates; a deployment that will not serve
 * the owner is refused before anything is allocated; a registration that
 * failed for a retryable reason is finished on the same vault by the next
 * create, never by a new index; a script another vault holds, or that this
 * owner's other vaults push a commitment of, is `scriptTaken` and the vault is
 * marked unknown so it is never retried; and a runtime failure leaves the
 * allocated vault to be finished later.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { QSB_HARNESS_PASSPHRASE, qsbVaultHarness } from "../../support/qsb-vault-harness";

const CREATE = { accountId: "qsb-1", type: "wallet.createQsbVault" } as const;

const journalOf = async (harness: Awaited<ReturnType<typeof qsbVaultHarness>>) => {
  const journal = await harness.service.withQsbVaultAccount(
    { accountId: "qsb-1", vaultPassphrase: QSB_HARNESS_PASSPHRASE },
    (access) => access.journal(),
  );
  if (journal.status !== "bound") throw new Error("journal unbound");
  return journal;
};

const registrations = (harness: Awaited<ReturnType<typeof qsbVaultHarness>>): number =>
  harness.state.calls.filter((call) => call === "POST /vaults").length;

describe("creating a QSB vault", () => {
  test("refuses an account that is not a writer, writing nothing", async () => {
    const harness = await qsbVaultHarness();
    await harness.service.importQsbAccount({
      mnemonic: `${"legal winner thank year wave sausage worth useful ".repeat(3)}`.replace(
        /useful $/,
        "title",
      ),
      vaultPassphrase: QSB_HARNESS_PASSPHRASE,
    });
    harness.events.length = 0;
    expect(await harness.send({ accountId: "qsb-2", type: "wallet.createQsbVault" })).toEqual({
      error: QSB_VAULT_REFUSALS.notWriter,
    });
    expect(harness.events).toEqual([]);
  }, 60_000);

  test("refuses a deployment that will not serve this owner, before allocating", async () => {
    const harness = await qsbVaultHarness();
    harness.state.config = { ...harness.state.config, ownerLimits: null };
    expect(await harness.send(CREATE)).toEqual({ error: QSB_VAULT_REFUSALS.coordinatorDisabled });
    harness.state.config = {
      ...harness.state.config,
      network: "testnet",
      ownerLimits: { allowlisted: null },
    };
    expect(await harness.send(CREATE)).toEqual({ error: QSB_VAULT_REFUSALS.coordinatorDisabled });
    expect((await journalOf(harness)).nextV).toBe(0);
  }, 60_000);

  test("a retryable registration failure is finished on the same vault", async () => {
    const harness = await qsbVaultHarness();
    harness.state.refusals.set("POST /vaults", { code: "chain_unavailable", status: 503 });
    expect(await harness.send(CREATE)).toEqual({
      error: QSB_VAULT_REFUSALS.coordinatorUnavailable,
    });
    expect((await journalOf(harness)).vaults.map((vault) => vault.state)).toEqual(["allocated"]);
    harness.state.refusals.clear();
    expect(await harness.send(CREATE)).toMatchObject({
      ok: true,
      vault: { registered: true, v: 0 },
    });
    const journal = await journalOf(harness);
    expect(journal.nextV).toBe(1);
    expect(registrations(harness)).toBe(2);
    // A further create makes a new vault: the first is registered now.
    expect(await harness.send(CREATE)).toMatchObject({ ok: true, vault: { v: 1 } });
  }, 60_000);

  test("a registration whose reply was lost is found by script hash, not registered twice", async () => {
    const harness = await qsbVaultHarness();
    await harness.send(CREATE);
    // The coordinator holds vault 0; the journal still lists it allocated.
    expect(await harness.send({ accountId: "qsb-1", type: "wallet.qsbVaults" })).toMatchObject({
      vaults: [{ registered: true, v: 0 }],
    });
    expect(registrations(harness)).toBe(1);
  }, 60_000);

  test.each([
    ["vault_script_registered", 409],
    ["vault_script_paid", 409],
  ])(
    "%s is scriptTaken: the vault is marked unknown and never retried",
    async (code, status) => {
      const harness = await qsbVaultHarness();
      harness.state.refusals.set("POST /vaults", { code, status });
      expect(await harness.send(CREATE)).toEqual({ error: QSB_VAULT_REFUSALS.scriptTaken });
      expect((await journalOf(harness)).vaults.map((vault) => vault.state)).toEqual(["unknown"]);
      harness.state.refusals.clear();
      expect(await harness.send(CREATE)).toMatchObject({ ok: true, vault: { v: 1 } });
      expect(await harness.send({ accountId: "qsb-1", type: "wallet.qsbVaults" })).toMatchObject({
        vaults: [
          { registered: false, state: "unknown", v: 0 },
          { registered: true, state: "allocated", v: 1 },
        ],
      });
    },
    60_000,
  );

  test("a vault of this owner pushing one of the new vault's commitments is scriptTaken", async () => {
    const harness = await qsbVaultHarness();
    // Learn vault 0's script while its registration fails, then have another
    // vault of this owner push one of its commitments.
    harness.state.refusals.set("POST /vaults", { code: "chain_error", status: 502 });
    await harness.send(CREATE);
    const [record] = (await journalOf(harness)).vaults;
    const scriptHex = `14${(record?.scriptPubKey ?? "").slice(2, 42)}ac`.padEnd(200, "51");
    const scriptHash = createHash("sha256").update(Buffer.from(scriptHex, "hex")).digest("hex");
    const id = "22222222-2222-4222-8222-222222222222";
    harness.state.vaults.set(id, {
      raw: null,
      vault: {
        config: "A",
        configuration: {
          config: "A",
          generatorCommit: "2c9172051d5c150ef0a994ca6b988a08a3ef9e85",
          network: "mainnet",
          protocol: "qsb-config-a-v1",
          publicStateHash: "ab".repeat(32),
          scriptBytesHash: scriptHash,
          scriptHash,
        },
        createdAt: "2026-11-04T12:00:00.000Z",
        id,
        name: "Another vault",
        network: "mainnet",
        paymentAddress: harness.owner,
        publicStateJson: "{}",
        scriptHash,
        scriptHex,
        status: "unfunded",
      },
    });
    harness.state.refusals.clear();
    expect(await harness.send(CREATE)).toEqual({ error: QSB_VAULT_REFUSALS.scriptTaken });
    expect((await journalOf(harness)).vaults.map((vault) => vault.state)).toEqual(["unknown"]);
    expect(registrations(harness)).toBe(1);
  }, 60_000);

  test("a registration refused as invalid is runtimeUnavailable, the vault left allocated", async () => {
    const harness = await qsbVaultHarness();
    harness.state.refusals.set("POST /vaults", { code: "vault_invalid", status: 400 });
    expect(await harness.send(CREATE)).toEqual({ error: QSB_VAULT_REFUSALS.runtimeUnavailable });
    expect((await journalOf(harness)).vaults.map((vault) => vault.state)).toEqual(["allocated"]);
  }, 60_000);

  test("a runtime failure leaves the allocated vault to be finished later", async () => {
    const harness = await qsbVaultHarness();
    const setup = harness.runtime.setupFromCommitments;
    harness.runtime.setupFromCommitments = async () => {
      throw new Error("QSB interpreter failed to load");
    };
    expect(await harness.send(CREATE)).toEqual({ error: QSB_VAULT_REFUSALS.runtimeUnavailable });
    const [record] = (await journalOf(harness)).vaults;
    expect(record).toMatchObject({ scriptPubKey: null, state: "allocated", v: 0 });
    expect(registrations(harness)).toBe(0);
    harness.runtime.setupFromCommitments = setup;
    expect(await harness.send(CREATE)).toMatchObject({
      ok: true,
      vault: { registered: true, v: 0 },
    });
  }, 60_000);

  test("an unknown account is refused as one", async () => {
    const harness = await qsbVaultHarness();
    expect(await harness.send({ accountId: "qsb-7", type: "wallet.createQsbVault" })).toEqual({
      error: QSB_ACCOUNT_REFUSALS.unknownAccount,
    });
  }, 60_000);
});
