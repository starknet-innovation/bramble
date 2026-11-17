/**
 * `wallet.revealSecrets` with a wrong passphrase, through the real encrypted
 * store and vault service.
 *
 * The reveal re-reads the vault with the passphrase typed on the screen. A
 * wrong one fails AES-GCM authentication, which the browser reports as a
 * DOMException ("The operation failed for an operation-specific reason"). The
 * reveal used to send that text back as its refusal, and the panel has no copy
 * for it, so the reader never saw "That passphrase is wrong.". It now answers
 * "Incorrect passphrase", as unlock does, while a corrupt store envelope keeps
 * its own refusal.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore, INVALID_ENVELOPE } from "@bramble/vault/encrypted-store";
import { emptyVault, type Vault } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import { createWalletReader } from "../../../apps/extension/src/background/accounts/wallet-reader";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { friendlyError } from "../../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error";
import {
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const vaultKey = "bramble:vault";
const wrongPassphrase = "wrong horse battery staple";
const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
// Full-width felts, as real addresses and keys are.
const address = "0x7c1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f";
const privateKey = "0x4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607182";

const softwareVault = (): Vault => {
  const id = `SN_MAIN:${address}`;
  return {
    ...emptyVault(),
    accounts: [
      {
        accountContractType: "openzeppelin",
        address,
        classHash: "0x61dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f",
        derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
        id,
        networkId: "SN_MAIN",
        publicKeyX: "0x2f3e4d5c6b7a8998a7b6c5d4e3f2011f2e3d4c5b6a798897a6b5c4d3e2f1001",
        publicKeyY: "0x3e4d5c6b7a8998a7b6c5d4e3f2011f2e3d4c5b6a798897a6b5c4d3e2f100121",
      },
    ],
    activeAccountId: id,
    mnemonic,
    signingKeys: [{ accountId: id, privateKey }],
  };
};

// One install wired like `background/index.ts`, on a vault written with the
// real AES-GCM envelope.
const install = async () => {
  const local = createMemoryStore();
  const encryptedStore = createEncryptedStore(local, vaultKey);
  await encryptedStore.write(softwareVault(), vaultPassphrase);
  const service = createWalletVaultService({
    encryptedStore,
    kms: fakeKms(),
    migrationStore: createEncryptedStore(local, "bramble:vault-migration"),
  });
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_MAIN");
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const handler = createMessageHandler(
    createWalletReader(Promise.resolve(service)),
    testExtension,
    { preferencesStore, session },
  );
  return { handler, local, service };
};

describe("wallet.revealSecrets passphrase check", () => {
  test("reveals the phrase and key for the right passphrase", async () => {
    const { handler } = await install();
    await expect(
      handler({ type: "wallet.revealSecrets", vaultPassphrase }, sender),
    ).resolves.toEqual({ mnemonic, ok: true, privateKey });
  });

  test("answers Incorrect passphrase, which the panel words, for a wrong one", async () => {
    const { handler, service } = await install();
    // The vault read really fails AES-GCM authentication: nothing is stubbed.
    await expect(service.readVault(wrongPassphrase)).rejects.toMatchObject({
      name: "OperationError",
    });

    const reply = await handler(
      { type: "wallet.revealSecrets", vaultPassphrase: wrongPassphrase },
      sender,
    );

    expect(reply).toEqual({ error: "Incorrect passphrase" });
    expect(friendlyError((reply as { readonly error: string }).error).message).toBe(
      "That passphrase is wrong.",
    );
  });

  test("keeps a corrupt store envelope's own refusal", async () => {
    const { handler, local } = await install();
    await local.set(vaultKey, { not: "an encrypted envelope" });

    await expect(
      handler({ type: "wallet.revealSecrets", vaultPassphrase }, sender),
    ).resolves.toEqual({ error: INVALID_ENVELOPE });
  });
});
