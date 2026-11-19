/** Explicit provenance survives vault writes; migration never reconstructs it. */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { migrateVault, VAULT_MIGRATIONS } from "@bramble/vault/migrations";
import { emptyVault, isVaultV13, isVaultV14 } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";

const passphrase = "correct horse battery staple";
const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const service = () =>
  createWalletVaultService({
    encryptedStore: createEncryptedStore(createMemoryStore(), "bramble:vault"),
    migrationStore: createEncryptedStore(createMemoryStore(), "bramble:migration"),
    kms: fakeKms(),
  });

describe("schema v14 provenance", () => {
  test("adjacent deterministic migration leaves provenance missing", () => {
    const old = { ...emptyVault(), schemaVersion: 13 };
    expect(isVaultV13(old)).toBe(true);
    expect(VAULT_MIGRATIONS.at(-1)).toMatchObject({ fromVersion: 13, toVersion: 14 });
    const current = migrateVault(old);
    expect(current.accountProvenance).toBeUndefined();
    expect(isVaultV14(current)).toBe(true);
    expect(migrateVault(current)).toEqual(current);
    expect(isVaultV14({ ...current, accountProvenance: { "SN_MAIN:0x123": "imported" } })).toBe(
      false,
    );
  });

  test("records explicit creation and rejects unsupported provenance", async () => {
    const createdService = service();
    const created = await createdService.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      vaultPassphrase: passphrase,
    });
    expect((await createdService.readVault(passphrase)).accountProvenance?.[created.id]).toBe(
      "created",
    );
    const vault = await createdService.readVault(passphrase);
    const { accountProvenance, ...legacy } = vault;
    expect(accountProvenance?.[created.id]).toBe("created");
    expect(migrateVault({ ...legacy, schemaVersion: 13 }).accountProvenance).toBeUndefined();
    expect(isVaultV14({ ...vault, accountProvenance: { [created.id]: "guessed" } })).toBe(false);
    expect(migrateVault(vault)).toEqual(vault);
  });
});
