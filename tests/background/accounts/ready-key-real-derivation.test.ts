/**
 * Ready-key import over the real Krusty KMS and the real encrypted vault
 * (issue 776). The other suites stub derivation, so they would pass even if
 * the vault derived every release at one constructor. Here the vault's
 * key-free preview must land on the address `accountAddressCandidates` gives
 * for each Argent release, the function pinned against real Mainnet accounts
 * (0.3.0 and 0.3.1 among them) in `account-candidates.test.ts`. The writes
 * must store every picked release at once, or nothing.
 */
import { describe, expect, test } from "bun:test";
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { accountAddressCandidates } from "@bramble/starknet/account-contracts";
import { createMemoryStore } from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createWalletVaultService } from "@bramble/vault/service";
import { deploymentClasses } from "@bramble/wallet-model/account-families";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";
import { NO_READY_ACCOUNT_FOR_KEY } from "@bramble/wallet-model/recovery";
import { createWalletReader } from "../../../apps/extension/src/background/accounts/wallet-reader";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

// Clearly-fake test vector; not a real key and holds nothing on any network.
const privateKey = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
const keyDigits = privateKey.slice(2);

const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
const freshService = () =>
  createWalletVaultService({
    encryptedStore: createEncryptedStore(createMemoryStore(), "bramble:vault"),
    kms,
    migrationStore: createEncryptedStore(createMemoryStore(), "bramble:vault-migration"),
  });
const releases = deploymentClasses("argent");
const release = (label: string): string => {
  const entry = releases.find((candidate) => candidate.label === label);
  if (!entry) throw new Error(`missing ${label}`);
  return entry.classHash;
};

describe("Ready-key preview over real Krusty", () => {
  test("each release previews at the address real Mainnet accounts pin, with no key", async () => {
    const service = freshService();
    for (const entry of releases) {
      const preview = await service.previewImportedAccount({
        accountContractType: "argent",
        classHash: entry.classHash,
        networkId: "SN_MAIN",
        privateKey,
      });
      const expected = accountAddressCandidates(preview.publicKeyX, "argent").find((candidate) =>
        sameFelt(candidate.entry.classHash, entry.classHash),
      );
      expect(expected).toBeDefined();
      expect(sameFelt(preview.address, expected?.address ?? "")).toBe(true);
      expect(JSON.stringify(preview)).not.toContain(keyDigits);
    }
  });

  test("0.3.1 and 0.4.0 put one key at two different addresses", async () => {
    const service = freshService();
    const [old, current] = await Promise.all(
      ["argent 0.3.1", "argent 0.4.0"].map((label) =>
        service.previewImportedAccount({
          accountContractType: "argent",
          classHash: release(label),
          networkId: "SN_MAIN",
          privateKey,
        }),
      ),
    );
    expect(old?.address).not.toBe(current?.address);
  });
});

describe("Ready-key writes over the real vault", () => {
  test("a first-run vault holds every picked release, each signing with the one key", async () => {
    const service = freshService();
    const picked = [release("argent 0.3.1"), release("argent 0.4.0")];
    const first = await service.createKeyVault({
      accountContractType: "argent",
      classHashes: picked,
      networkId: "SN_MAIN",
      privateKey,
      vaultPassphrase,
    });
    const vault = await service.readVault(vaultPassphrase);
    expect(vault.accounts).toHaveLength(2);
    expect(vault.activeAccountId).toBe(first.id);
    expect(vault.accounts.map((account) => canonicalFelt(account.classHash)).sort()).toEqual(
      picked.map((classHash) => canonicalFelt(classHash)).sort(),
    );
    expect(new Set(vault.signingKeys.map((entry) => canonicalFelt(entry.privateKey)))).toEqual(
      new Set([canonicalFelt(privateKey)]),
    );
  });

  test("a pick already stored refuses the whole import and writes nothing", async () => {
    const service = freshService();
    await service.createKeyVault({
      accountContractType: "argent",
      classHashes: [release("argent 0.3.1")],
      networkId: "SN_MAIN",
      privateKey,
      vaultPassphrase,
    });
    await expect(
      service.importRawKeyAccount({
        accountContractType: "argent",
        classHashes: [release("argent 0.4.0"), release("argent 0.3.1")],
        networkId: "SN_MAIN",
        privateKey,
        vaultPassphrase,
      }),
    ).rejects.toBeInstanceOf(RefusedBeforeWrite);
    expect((await service.readVault(vaultPassphrase)).accounts).toHaveLength(1);
  });

  test("a pick the chain no longer shows writes nothing through the real handler", async () => {
    const service = freshService();
    await service.createKeyVault({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      privateKey,
      vaultPassphrase,
    });
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      createWalletReader(Promise.resolve(service)),
      testExtension,
      {
        preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
        runtimeRpc: {
          ...defaultRuntimeRpc,
          getDeploymentStatus: async () => false,
          getTokenBalances: async ({ tokens }) =>
            tokens.map((token) => ({ ...token, balance: "0", formatted: "0" })),
        },
        session,
      },
    );
    const response = await handler(
      {
        accountContractType: "argent",
        classHashes: [release("argent 0.3.1")],
        networkId: "SN_MAIN",
        privateKey,
        type: "wallet.importAccount",
      },
      sender,
    );
    expect(response).toEqual({ error: NO_READY_ACCOUNT_FOR_KEY });
    expect(JSON.stringify(response)).not.toContain(keyDigits);
    expect((await service.readVault(vaultPassphrase)).accounts).toHaveLength(1);
    expect(session.isUnlocked()).toBe(true);
  });
});
