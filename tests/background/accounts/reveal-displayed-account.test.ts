/**
 * `wallet.revealSecrets` reveals the account the panel shows as active
 * (Sherlock 191).
 *
 * The panel's active account is per network: `wallet.status` resolves it from
 * the vault's stored pointer, the active network and the hidden accounts. The
 * reveal used to read the stored pointer alone, so when the pointer named an
 * account on another network it returned that account's key under the shown
 * account's label, and the screen's imported-key warning described the wrong
 * account.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { testExtension } from "../../support/background-wallet-stub";

const accountAt = (
  networkId: AccountRef["networkId"],
  address: string,
  derivation: AccountRef["derivation"],
): AccountRef =>
  ({
    accountContractType: "openzeppelin",
    address,
    classHash: "0xabcdef",
    derivation,
    id: `${networkId}:${address}`,
    networkId,
    publicKeyX: "0xabc",
    publicKeyY: "0xdef",
  }) as AccountRef;

const bip44 = { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" } as const;
const importedMainnet = accountAt("SN_MAIN", "0xa1", { kind: "imported-raw-key" });
const derivedMainnet = accountAt("SN_MAIN", "0xa2", bip44);
const derivedSepolia = accountAt("SN_SEPOLIA", "0xb1", bip44);

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const keyFor: Record<string, string> = {
  [derivedMainnet.id]: "0x2222",
  [derivedSepolia.id]: "0x3333",
  [importedMainnet.id]: "0x1111",
};

// The vault's stored pointer names the imported mainnet account.
const wallet = {
  async readVault(passphrase: string) {
    if (passphrase !== vaultPassphrase) throw new Error("bad passphrase");
    const accounts = [importedMainnet, derivedMainnet, derivedSepolia];
    return {
      accounts,
      accountSecrets: [],
      activeAccountId: importedMainnet.id,
      importedSeeds: [],
      mnemonic,
      originGrants: [],
      schemaVersion: 11 as const,
      signingKeys: accounts.map((stored) => ({
        accountId: stored.id,
        privateKey: keyFor[stored.id] ?? "",
      })),
    };
  },
};

const handlerWith = (preferences: Partial<ReturnType<typeof defaultWalletPreferences>>) =>
  createMessageHandler(wallet as never, testExtension, {
    preferencesStore: {
      ...unavailablePreferencesStore,
      read: async () => ({ ...defaultWalletPreferences(), ...preferences }),
    },
  });

describe("wallet.revealSecrets", () => {
  test("reveals the stored pointer's account when the panel shows it", async () => {
    const handler = handlerWith({ activeNetworkId: "SN_MAIN" });
    await expect(
      handler({ type: "wallet.revealSecrets", vaultPassphrase }, sender),
    ).resolves.toEqual({ mnemonic, ok: true, privateKey: "0x1111" });
  });

  test("reveals the account on the active network, not the stored pointer", async () => {
    const handler = handlerWith({ activeNetworkId: "SN_SEPOLIA" });
    await expect(
      handler({ type: "wallet.revealSecrets", vaultPassphrase }, sender),
    ).resolves.toEqual({ mnemonic, ok: true, privateKey: "0x3333" });
  });

  test("keeps a hidden pointed-at account on its own network, as the status does", async () => {
    const handler = handlerWith({
      activeNetworkId: "SN_MAIN",
      hiddenAccountIds: [importedMainnet.id],
    });
    // The pointed-at account is on the active network, so the status keeps it
    // even though it is hidden; the reveal must agree with the status.
    await expect(
      handler({ type: "wallet.revealSecrets", vaultPassphrase }, sender),
    ).resolves.toEqual({ mnemonic, ok: true, privateKey: "0x1111" });
  });

  test("reveals the recovery phrase alone when the active network has no account", async () => {
    const sepolialess = {
      ...wallet,
      async readVault(passphrase: string) {
        const vault = await wallet.readVault(passphrase);
        return { ...vault, accounts: vault.accounts.filter((a) => a.networkId === "SN_MAIN") };
      },
    };
    const phraseOnly = createMessageHandler(sepolialess as never, testExtension, {
      preferencesStore: {
        ...unavailablePreferencesStore,
        read: async () => ({ ...defaultWalletPreferences(), activeNetworkId: "SN_SEPOLIA" }),
      },
    });
    await expect(
      phraseOnly({ type: "wallet.revealSecrets", vaultPassphrase }, sender),
    ).resolves.toEqual({ mnemonic, ok: true, privateKey: null });
  });
});
