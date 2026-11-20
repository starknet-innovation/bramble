/**
 * Vault-service origin-grant checks: which accounts a connected site may see,
 * how the active account narrows and orders that view, and revocation. Split
 * from vault-service.test.ts (file-size budget) by behaviour — the pure policy
 * these exercise end-to-end lives in tests/wallet/origin-grants.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { KmsPort } from "@bramble/vault/kms-port";
import { createWalletVaultService } from "@bramble/vault/service";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultKey = "bramble:vault";
const migrationKey = "bramble:vault-migration";
const vaultPassphrase = "correct horse battery staple";
const defaultAccountInput = {
  accountContractType: "openzeppelin",
  mnemonic,
  vaultPassphrase,
} as const;

// KMS whose keypair varies by account index so derived accounts stay distinct.
const indexedKms = (): KmsPort => ({
  ...fakeKms(),
  async deriveStarknetKeypair(_mnemonic, _addressIndex, accountIndex) {
    return {
      privateKey: `0x1234${accountIndex + 1}`,
      publicKeyX: `0xabc${accountIndex}`,
      publicKeyY: "0xdef",
    };
  },
});

describe("createWalletVaultService origin grants", () => {
  test("grants origins access only to selected accounts", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    const account = await service.createAccount(defaultAccountInput);

    await expect(
      service.grantOrigin({
        origin: "https://example.com",
        vaultPassphrase,
      }),
    ).resolves.toEqual([account]);
    await expect(
      service.getGrantedAccounts("https://example.com", vaultPassphrase),
    ).resolves.toEqual([account]);
    await expect(
      service.getGrantedAccounts("https://evil.example", vaultPassphrase),
    ).resolves.toEqual([]);
    await expect(
      service.grantOrigin({
        origin: "http://127.0.0.1:5173",
        vaultPassphrase,
      }),
    ).resolves.toEqual([account]);
  });

  test("scopes granted accounts to the active account", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: indexedKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    const first = await service.createAccount(defaultAccountInput);
    const second = await service.addDerivedAccount({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      vaultPassphrase,
    });
    await service.grantOrigin({
      accountId: first.id,
      origin: "https://example.com",
      vaultPassphrase,
    });

    // The grant names only the first account, so switching away hides the site.
    await expect(
      service.getGrantedAccounts("https://example.com", vaultPassphrase),
    ).resolves.toEqual([]);
    await service.setActiveAccount({ accountId: first.id, vaultPassphrase });
    await expect(
      service.getGrantedAccounts("https://example.com", vaultPassphrase),
    ).resolves.toEqual([first]);

    // Approving the site on the second account too unions both ids into the
    // stored grant, but the site still only ever sees the active one — a second
    // approval must never widen the view to both addresses at once.
    await service.grantOrigin({
      accountId: second.id,
      origin: "https://example.com",
      vaultPassphrase,
    });
    await expect(
      service.getGrantedAccounts("https://example.com", vaultPassphrase),
    ).resolves.toEqual([first]);
    await service.setActiveAccount({ accountId: second.id, vaultPassphrase });
    await expect(
      service.getGrantedAccounts("https://example.com", vaultPassphrase),
    ).resolves.toEqual([second]);
    // The stored grant still records both, so the connected-sites manager keeps
    // showing the real history and one revoke clears all of it.
    const vault = await service.readVault(vaultPassphrase);
    expect(vault.originGrants).toEqual([
      { accountIds: [first.id, second.id], origin: "https://example.com" },
    ]);
  });

  test("rejects insecure origin grants", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    await service.createAccount(defaultAccountInput);

    await expect(
      service.grantOrigin({
        origin: "http://example.com",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid origin");
    await expect(service.getGrantedAccounts("http://example.com", vaultPassphrase)).rejects.toThrow(
      "Invalid origin",
    );
  });

  test("rolls back a grant when its live authorization expires during persistence", async () => {
    const backend = createMemoryStore();
    const primary = createEncryptedStore(backend, vaultKey);
    const service = createWalletVaultService({
      encryptedStore: primary,
      kms: fakeKms(),
      migrationStore: createEncryptedStore(backend, migrationKey),
    });
    await service.createAccount(defaultAccountInput);
    let checks = 0;

    await expect(
      service.grantOrigin({
        isAuthorized: () => {
          checks += 1;
          return checks < 3;
        },
        origin: "https://example.com",
        vaultPassphrase,
      }),
    ).rejects.toThrow("wallet locked");
    expect((await service.readVault(vaultPassphrase)).originGrants).toEqual([]);
  });

  test("revokes an origin grant and reports the remaining connected sites", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    const account = await service.createAccount(defaultAccountInput);
    await service.grantOrigin({ origin: "https://alpha.example", vaultPassphrase });
    await service.grantOrigin({ origin: "https://beta.example", vaultPassphrase });
    const beta = {
      accountCount: 1,
      accountIds: [account.id],
      multisigIds: [],
      origin: "https://beta.example",
    };

    await expect(
      service.revokeOrigin({ origin: "https://alpha.example", vaultPassphrase }),
    ).resolves.toEqual([beta]);
    const vault = await service.readVault(vaultPassphrase);
    expect(vault.originGrants.map((grant) => grant.origin)).toEqual(["https://beta.example"]);
    await expect(
      service.getGrantedAccounts("https://alpha.example", vaultPassphrase),
    ).resolves.toEqual([]);
    await expect(
      service.revokeOrigin({ origin: "https://alpha.example", vaultPassphrase }),
    ).resolves.toEqual([beta]);
  });

  test("revokes one account from a site, then the site with its last account", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: indexedKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });
    const first = await service.createAccount(defaultAccountInput);
    const second = await service.addDerivedAccount({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      vaultPassphrase,
    });
    const origin = "https://example.com";
    await service.grantOrigin({ accountId: first.id, origin, vaultPassphrase });
    await service.grantOrigin({ accountId: second.id, origin, vaultPassphrase });
    await service.setActiveAccount({ accountId: first.id, vaultPassphrase });

    await expect(
      service.revokeOrigin({ accountId: first.id, origin, vaultPassphrase }),
    ).resolves.toEqual([{ accountCount: 1, accountIds: [second.id], multisigIds: [], origin }]);
    // The active account lost its grant, so the site now sees nothing.
    await expect(service.getGrantedAccounts(origin, vaultPassphrase)).resolves.toEqual([]);
    await service.setActiveAccount({ accountId: second.id, vaultPassphrase });
    await expect(service.getGrantedAccounts(origin, vaultPassphrase)).resolves.toEqual([second]);

    await expect(
      service.revokeOrigin({ accountId: second.id, origin, vaultPassphrase }),
    ).resolves.toEqual([]);
    expect((await service.readVault(vaultPassphrase)).originGrants).toEqual([]);
  });

  test("treats an account the site was not given as a no-op", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: indexedKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });
    const first = await service.createAccount(defaultAccountInput);
    const second = await service.addDerivedAccount({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      vaultPassphrase,
    });
    await service.grantOrigin({
      accountId: first.id,
      origin: "https://a.example",
      vaultPassphrase,
    });
    await service.grantOrigin({
      accountId: second.id,
      origin: "https://b.example",
      vaultPassphrase,
    });
    const before = (await service.readVault(vaultPassphrase)).originGrants;

    // The id exists in the wallet but belongs to another site's grant.
    await service.revokeOrigin({
      accountId: second.id,
      origin: "https://a.example",
      vaultPassphrase,
    });
    await service.revokeOrigin({
      accountId: `SN_MAIN:0x${"9".repeat(40)}`,
      origin: "https://a.example",
      vaultPassphrase,
    });
    expect((await service.readVault(vaultPassphrase)).originGrants).toEqual(before);
    await expect(
      service.revokeOrigin({
        accountId: "not-an-id",
        origin: "https://a.example",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid account id");
    expect((await service.readVault(vaultPassphrase)).originGrants).toEqual(before);
  });

  test("rejects revoking an insecure origin", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    await service.createAccount(defaultAccountInput);
    await expect(
      service.revokeOrigin({ origin: "http://example.com", vaultPassphrase }),
    ).rejects.toThrow("Invalid origin");
  });
});
