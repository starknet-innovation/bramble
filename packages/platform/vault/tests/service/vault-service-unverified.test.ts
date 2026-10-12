/**
 * A vault the store cannot verify (Sherlock #138), at the service boundary.
 *
 * `status` names why a stored vault cannot be unlocked normally, so the panel
 * offers recovery instead of an unlock that cannot succeed. Recovering accepts
 * the possibly older copy with the passphrase and drops every site connection
 * and retained Ledger viewing key, because a rollback can restore ones the user
 * removed and the user cannot tell which.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createWalletVaultService } from "@bramble/vault/service";

const vaultKey = "bramble:vault";
const migrationKey = "bramble:vault-migration";
const vaultPassphrase = "correct horse battery staple";

const lineageOf = (envelope: unknown): string => (envelope as { readonly lineage: string }).lineage;

// Wired like `background/index.ts`. `open` starts a fresh browser session.
const install = () => {
  const local = createMemoryStore();
  const sync = createMemoryStore();
  const open = () => {
    const session = createMemoryStore();
    return createWalletVaultService({
      encryptedStore: createEncryptedStore(local, vaultKey, sync, session, true),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(local, migrationKey, sync, session),
    });
  };
  return { local, open, sync };
};

// A Ledger vault with a connected site and a retained viewing key.
const populated = async () => {
  const parts = install();
  const service = parts.open();
  const account = await service.createLedgerVault({
    accountContractType: "openzeppelin",
    accountIndex: 0,
    networkId: "SN_MAIN",
    publicKeyX: "0xdef123",
    vaultPassphrase,
  });
  await service.grantOrigin({ origin: "https://example.com", vaultPassphrase });
  await service.storeLedgerStrk20ViewingKey({
    accountId: account.id,
    chainId: "0x534e5f4d41494e",
    poolAddress: "0x123",
    vaultPassphrase,
    viewingKey: "0x654321",
  });
  const vault = await service.readVault(vaultPassphrase);
  expect(vault.originGrants).not.toEqual([]);
  expect(vault.accountSecrets).not.toEqual([]);
  return { ...parts, account };
};

const dropRecords = async ({ local, sync }: ReturnType<typeof install>) => {
  const commitKey = `${vaultKey}:commit:${lineageOf(await local.get(vaultKey))}`;
  await sync.remove(commitKey);
  await local.remove(commitKey);
};

describe("status", () => {
  test("reports no recovery for a vault that verifies, or none at all", async () => {
    const { open } = install();
    expect((await open().status()).recovery).toBeUndefined();
    const service = open();
    await service.createLedgerVault({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });
    const status = await open().status();
    expect(status).toEqual({
      accountCount: 0,
      activeAccountId: null,
      hasVault: true,
      locked: true,
      ready: true,
    });
  });

  test("reports unverified when no record vouches for the vault", async () => {
    const parts = await populated();
    await dropRecords(parts);
    expect((await parts.open().status()).recovery).toBe("unverified");
  });

  test("reports rollback when sync names a newer copy", async () => {
    const parts = await populated();
    const envelope = await parts.local.get(vaultKey);
    const commitKey = `${vaultKey}:commit:${lineageOf(envelope)}`;
    const mirror = await parts.local.get(commitKey);
    await parts.open().revokeOrigin({ origin: "https://example.com", vaultPassphrase });
    await parts.local.set(vaultKey, envelope as Json);
    await parts.local.set(commitKey, mirror as Json);

    expect((await parts.open().status()).recovery).toBe("rollback");
  });

  test("reports invalid when the stored vault is malformed", async () => {
    const parts = install();
    await parts.local.set(vaultKey, { corrupted: true });
    expect((await parts.open().status()).recovery).toBe("invalid");
  });

  test("still offers recovery when the staged copy does not verify", async () => {
    const parts = await populated();
    await dropRecords(parts);
    await parts.local.set(migrationKey, { staged: true });
    expect((await parts.open().status()).recovery).toBe("unverified");
  });

  test("leaves a staged copy that verifies to the normal unlock, which then succeeds", async () => {
    const parts = await populated();
    const envelope = await parts.local.get(vaultKey);
    const commitKey = `${vaultKey}:commit:${lineageOf(envelope)}`;
    const mirror = await parts.local.get(commitKey);
    await parts.open().revokeOrigin({ origin: "https://example.com", vaultPassphrase });
    const current = await parts.open().readVault(vaultPassphrase);
    await parts.local.set(vaultKey, envelope as Json);
    await parts.local.set(commitKey, mirror as Json);
    // An interrupted migration's staged copy, with its own live records.
    await createEncryptedStore(parts.local, migrationKey, parts.sync).write(
      current,
      vaultPassphrase,
    );

    const service = parts.open();
    expect((await service.status()).recovery).toBeUndefined();
    expect(await service.readVault(vaultPassphrase)).toEqual(current);

    expect(await parts.local.get(migrationKey)).toBeUndefined();
    expect((await parts.open().status()).recovery).toBeUndefined();
  });

  test("clears an unparseable staged value and reads a vault that verifies (Sherlock 198)", async () => {
    const parts = await populated();
    await parts.local.set(migrationKey, "not an envelope");

    const service = parts.open();
    expect((await service.status()).recovery).toBeUndefined();
    expect((await service.readVault(vaultPassphrase)).accounts).toHaveLength(1);
    expect(await parts.local.get(migrationKey)).toBeUndefined();
  });

  test("answers without a recovery reason when storage fails", async () => {
    const local = createMemoryStore();
    await local.set(vaultKey, { corrupted: true });
    const failing = {
      get: () => Promise.reject(new Error("sync unavailable")),
      remove: () => Promise.reject(new Error("sync unavailable")),
      set: () => Promise.reject(new Error("sync unavailable")),
    };
    const store = createEncryptedStore(local, vaultKey, failing, createMemoryStore(), true);
    const service = createWalletVaultService({
      encryptedStore: {
        ...store,
        health: () => Promise.reject(new Error("sync unavailable")),
      },
      kms: fakeKms(),
      migrationStore: createEncryptedStore(local, migrationKey, failing),
    });

    expect(await service.status()).toEqual({
      accountCount: 0,
      activeAccountId: null,
      hasVault: true,
      locked: true,
      ready: true,
    });
  });
});

describe("recoverUnverifiedVault", () => {
  test("accepts the vault with the passphrase and drops connections and viewing keys", async () => {
    const parts = await populated();
    await dropRecords(parts);
    const service = parts.open();
    await expect(service.readVault(vaultPassphrase)).rejects.toThrow();

    await service.recoverUnverifiedVault(vaultPassphrase);

    const reopened = parts.open();
    expect((await reopened.status()).recovery).toBeUndefined();
    const vault = await reopened.readVault(vaultPassphrase);
    expect(vault.accounts.map((entry) => entry.id)).toEqual([parts.account.id]);
    expect(vault.originGrants).toEqual([]);
    expect(vault.accountSecrets).toEqual([]);
  });

  test("refuses a wrong passphrase and leaves the vault awaiting recovery", async () => {
    const parts = await populated();
    await dropRecords(parts);
    const service = parts.open();

    await expect(service.recoverUnverifiedVault("wrong horse battery staple")).rejects.toThrow();

    expect((await parts.open().status()).recovery).toBe("unverified");
  });

  test("refuses a vault that verifies", async () => {
    const parts = await populated();
    const service = parts.open();

    await expect(service.recoverUnverifiedVault(vaultPassphrase)).rejects.toThrow(
      "not awaiting recovery",
    );
    expect((await service.readVault(vaultPassphrase)).originGrants).not.toEqual([]);
  });
});
