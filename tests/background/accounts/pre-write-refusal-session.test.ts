/**
 * Refusals the vault raises before writing anything keep the session.
 *
 * Account additions run inside the guard that locks the session on any
 * failure, because a storage failure leaves the outcome ambiguous. A duplicate
 * account, an existing wallet, or a malformed recovery selection is refused
 * before any write, so the user stays signed in, the requested network write
 * is undone, and the vault is unchanged.
 */
import { describe, expect, test } from "bun:test";
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createWalletVaultService } from "@bramble/vault/service";
import { ec } from "starknet";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";

const vaultPassphrase = "correct horse battery staple";
const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
// Clearly-fake test vector; not a real key.
const importedKey = "0xfeedface";
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

// Raw-key import verifies its key through a signing probe, so the fake signs.
const importKms = () => ({
  ...fakeKms(),
  async deriveOzAccountAddress(publicKeyX: string, classHash: string) {
    return `0x${publicKeyX.slice(-16)}${classHash.slice(-6)}`;
  },
  async signStarkHash(privateKey: string, messageHash: string) {
    const signature = ec.starkCurve.sign(messageHash, privateKey);
    return {
      publicKey: ec.starkCurve.getStarkKey(privateKey),
      r: `0x${signature.r.toString(16)}`,
      s: `0x${signature.s.toString(16)}`,
    };
  },
});

const setup = async (kms = importKms()) => {
  const local = createMemoryStore();
  const encryptedStore = createEncryptedStore(local, "bramble:vault");
  const wallet = createWalletVaultService({
    encryptedStore,
    kms,
    migrationStore: createEncryptedStore(local, "bramble:vault-migration"),
  });
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const handler = createMessageHandler(wallet, testExtension, { preferencesStore, session });
  return { encryptedStore, handler, preferencesStore, session, wallet };
};

describe("a refusal before any vault write", () => {
  test("importing a key already in the wallet keeps the session and network", async () => {
    const { encryptedStore, handler, preferencesStore, session, wallet } = await setup();
    await wallet.createKeyVault?.({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      privateKey: importedKey,
      vaultPassphrase,
    });
    const before = await encryptedStore.read(vaultPassphrase);

    await expect(
      handler(
        {
          accountContractType: "openzeppelin",
          networkId: "SN_MAIN",
          privateKey: importedKey,
          type: "wallet.importAccount",
        },
        sender,
      ),
    ).resolves.toEqual({ error: "Account already exists" });

    expect(session.peekPassphrase()).toBe(vaultPassphrase);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_SEPOLIA");
    expect(await encryptedStore.read(vaultPassphrase)).toEqual(before);
  });

  test("scanning the own phrase of a phrase-less wallet keeps the session", async () => {
    const { handler, preferencesStore, session, wallet } = await setup();
    await wallet.createKeyVault?.({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      privateKey: importedKey,
      vaultPassphrase,
    });

    await expect(
      handler(
        {
          networkId: "SN_MAIN",
          selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
          type: "wallet.importOwnAccounts",
        },
        sender,
      ),
    ).resolves.toEqual({ error: "This wallet has no recovery phrase to scan" });

    expect(session.peekPassphrase()).toBe(vaultPassphrase);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_SEPOLIA");
  });

  test("the vault names each pre-write refusal as one", async () => {
    const { wallet } = await setup(fakeKms());
    const account = await wallet.createAccount({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      mnemonic,
      networkId: "SN_MAIN",
      vaultPassphrase,
    });
    expect(account.networkId).toBe("SN_MAIN");

    const refusals = [
      wallet.createAccount({
        accountContractType: "openzeppelin",
        accountIndex: 0,
        mnemonic,
        networkId: "SN_MAIN",
        vaultPassphrase,
      }),
      wallet.createKeyVault?.({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: importedKey,
        vaultPassphrase,
      }),
      wallet.importSeedAccounts?.({
        mnemonic,
        networkId: "SN_MAIN",
        selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
        vaultPassphrase,
      }),
      wallet.importSeedAccounts?.({
        mnemonic,
        networkId: "SN_MAIN",
        selections: [],
        vaultPassphrase,
      }),
    ];
    for (const refusal of refusals) {
      await expect(refusal).rejects.toBeInstanceOf(RefusedBeforeWrite);
    }
  });
});
