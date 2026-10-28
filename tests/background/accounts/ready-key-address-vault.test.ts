/**
 * Import by address for private-key wallets (issue 779) over the real Krusty
 * KMS and the real encrypted vault. The other suites stub the vault; here the
 * written account must keep the pasted address (and its id) rather than the
 * one the key derives, keep `imported-raw-key` provenance and the key bound to
 * that id, refuse a second import of the same account, and refuse an address
 * that comes with a release list or without its class.
 */
import { describe, expect, test } from "bun:test";
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createWalletVaultService } from "@bramble/vault/service";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { createWalletReader } from "../../../apps/extension/src/background/accounts/wallet-reader";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { argentOwner, PASTED } from "../../support/key-address-harness";

// Clearly-fake test vector; not a real key and holds nothing on any network.
const privateKey = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
const keyDigits = privateKey.slice(2);
const ADDRESS = canonicalFelt(PASTED) as string;

const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
const freshService = () =>
  createWalletVaultService({
    encryptedStore: createEncryptedStore(createMemoryStore(), "bramble:vault"),
    kms,
    migrationStore: createEncryptedStore(createMemoryStore(), "bramble:vault-migration"),
  });
const byAddress = {
  accountContractType: "argent",
  address: PASTED,
  classHash: ARGENT_ACCOUNT_CLASS_HASH,
  networkId: "SN_MAIN",
  privateKey,
} as const;

const publicKeyOf = async (): Promise<string> =>
  (
    await freshService().previewImportedAccount({
      accountContractType: "argent",
      networkId: "SN_MAIN",
      privateKey,
    })
  ).publicKeyX;

describe("the vault stores an address import at the pasted address", () => {
  test("first run: the vault's one account is the pasted address, signed by the key", async () => {
    const service = freshService();
    const account = await service.createKeyVault({ ...byAddress, vaultPassphrase });
    expect(account.address).toBe(ADDRESS);
    expect(account.id).toBe(`SN_MAIN:${ADDRESS}`);
    expect(account.derivation).toEqual({ kind: "imported-raw-key" });
    const vault = await service.readVault(vaultPassphrase);
    expect(vault.accounts).toEqual([account]);
    expect(vault.activeAccountId).toBe(account.id);
    expect(vault.signingKeys.map((entry) => entry.accountId)).toEqual([account.id]);
    expect(canonicalFelt(vault.signingKeys[0]?.privateKey ?? "")).toBe(canonicalFelt(privateKey));
  });

  test("in wallet: added beside the key's derived account, and not twice", async () => {
    const service = freshService();
    const derived = await service.createKeyVault({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      privateKey,
      vaultPassphrase,
    });
    const found = await service.importRawKeyAccount({ ...byAddress, vaultPassphrase });
    expect(found.address).toBe(ADDRESS);
    expect(found.address).not.toBe(derived.address);
    // Any spelling of the same address is the same account.
    await expect(
      service.importRawKeyAccount({
        ...byAddress,
        address: `0x000${PASTED.slice(2).toUpperCase()}`,
        vaultPassphrase,
      }),
    ).rejects.toThrow("Account already exists");
    expect((await service.readVault(vaultPassphrase)).accounts).toHaveLength(2);
  });

  test("an address with a release list, or without its class, is refused unwritten", async () => {
    const service = freshService();
    const malformed = [
      { ...byAddress, classHashes: [ARGENT_ACCOUNT_CLASS_HASH] },
      { ...byAddress, classHash: undefined },
      { ...byAddress, address: undefined },
      { ...byAddress, address: "0x0" },
    ];
    for (const input of malformed) {
      await expect(
        service.createKeyVault({ ...input, vaultPassphrase } as never),
      ).rejects.toBeInstanceOf(RefusedBeforeWrite);
    }
    const vault = await service.readVault(vaultPassphrase).catch(() => null);
    expect(vault?.accounts ?? []).toEqual([]);
  });
});

describe("an address import through the real handler", () => {
  test("proves the key against the chain's owner, then writes the pasted address", async () => {
    const service = freshService();
    await service.createKeyVault({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      privateKey,
      vaultPassphrase,
    });
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const owner = argentOwner(await publicKeyOf());
    const handler = createMessageHandler(
      createWalletReader(Promise.resolve(service)),
      testExtension,
      {
        preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
        runtimeRpc: {
          ...defaultRuntimeRpc,
          getAccountOwner: async () => owner,
          getArgentSigningRestriction: async () => null,
        },
        session,
      },
    );
    const found = await handler(
      { address: PASTED, networkId: "SN_MAIN", privateKey, type: "wallet.findKeyAccountByAddress" },
      sender,
    );
    expect(found).toMatchObject({ candidate: { address: ADDRESS }, ok: true });
    expect(JSON.stringify(found)).not.toContain(keyDigits);
    const { classHash } = (found as { readonly candidate: { readonly classHash: string } })
      .candidate;
    const response = await handler(
      { ...byAddress, classHash, type: "wallet.importAccount" },
      sender,
    );
    expect(response).toMatchObject({ account: { address: ADDRESS }, ok: true });
    expect(JSON.stringify(response)).not.toContain(keyDigits);
    const vault = await service.readVault(vaultPassphrase);
    expect(vault.accounts.map((account) => account.address)).toContain(ADDRESS);
  });
});
