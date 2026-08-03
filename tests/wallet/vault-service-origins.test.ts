/**
 * Vault-service origin-grant checks: which accounts a connected site may see,
 * how the active account narrows and orders that view, and revocation. Split
 * from vault-service.test.ts (file-size budget) by behaviour — the pure policy
 * these exercise end-to-end lives in tests/wallet/origin-grants.test.ts.
 */
import { describe, expect, test } from "bun:test";
import type { KrustyKms } from "../../src/crypto/krusty";
import { createEncryptedStore } from "../../src/storage/encrypted-store";
import { createMemoryStore } from "../../src/storage/kv";
import { createWalletVaultService } from "../../src/wallet/vault-service";
import { fakeKms } from "../support/fake-kms";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultKey = "mc-wallet:vault";
const vaultPassphrase = "correct horse battery staple";

// KMS whose keypair varies by account index so derived accounts stay distinct.
const indexedKms = (): KrustyKms => ({
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
    });

    const account = await service.createAccount({ mnemonic, vaultPassphrase });

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
    });

    const first = await service.createAccount({ mnemonic, vaultPassphrase });
    const second = await service.addDerivedAccount({ networkId: "SN_MAIN", vaultPassphrase });
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
    });

    await service.createAccount({ mnemonic, vaultPassphrase });

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

  test("revokes an origin grant and reports the remaining connected sites", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
    });

    await service.createAccount({ mnemonic, vaultPassphrase });
    await service.grantOrigin({ origin: "https://alpha.example", vaultPassphrase });
    await service.grantOrigin({ origin: "https://beta.example", vaultPassphrase });

    await expect(
      service.revokeOrigin({ origin: "https://alpha.example", vaultPassphrase }),
    ).resolves.toEqual([{ accountCount: 1, origin: "https://beta.example" }]);
    const vault = await service.readVault(vaultPassphrase);
    expect(vault.originGrants.map((grant) => grant.origin)).toEqual(["https://beta.example"]);
    await expect(
      service.getGrantedAccounts("https://alpha.example", vaultPassphrase),
    ).resolves.toEqual([]);
    await expect(
      service.revokeOrigin({ origin: "https://alpha.example", vaultPassphrase }),
    ).resolves.toEqual([{ accountCount: 1, origin: "https://beta.example" }]);
  });

  test("rejects revoking an insecure origin", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
    });

    await service.createAccount({ mnemonic, vaultPassphrase });
    await expect(
      service.revokeOrigin({ origin: "http://example.com", vaultPassphrase }),
    ).rejects.toThrow("Invalid origin");
  });
});
