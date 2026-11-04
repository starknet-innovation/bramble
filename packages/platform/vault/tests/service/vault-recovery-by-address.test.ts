/**
 * A selection found by its address (issue 398) is written at that address: no
 * derivation reproduces it, so the vault keeps the address the background
 * proved, and the coordinate still decides which key signs for it.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { KmsPort } from "@bramble/vault/kms-port";
import { isVaultV12 } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const otherPhrase = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const vaultPassphrase = "correct horse battery staple";
const PROVED = "0x7e57ad0e55";

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

const serviceWith = (kms: KmsPort = indexedKms()) => {
  const store = createMemoryStore();
  return createWalletVaultService({
    encryptedStore: createEncryptedStore(store, "bramble:vault"),
    kms,
    migrationStore: createEncryptedStore(store, "bramble:vault-migration"),
  });
};

const ownLadderPick = {
  accountContractType: "argent",
  accountIndex: 3,
  classHash: ARGENT_ACCOUNT_CLASS_HASH,
  derivation: "starknet-bip44",
} as const;

describe("vault recovery of an account found by its address", () => {
  test("records the proved address with the key its coordinate derives", async () => {
    const service = serviceWith();
    const [restored] = await service.recoverAccounts({
      mnemonic,
      networkId: "SN_MAIN",
      selections: [{ ...ownLadderPick, address: PROVED }],
      vaultPassphrase,
    });
    expect(restored).toMatchObject({
      accountContractType: "argent",
      address: PROVED,
      derivation: { accountIndex: 3, kind: "starknet-bip44" },
      id: `SN_MAIN:${PROVED}`,
      publicKeyX: "0xabc3",
    });
    const vault = await service.readVault(vaultPassphrase);
    expect(isVaultV12(vault)).toBe(true);
    expect(vault.signingKeys).toEqual([{ accountId: `SN_MAIN:${PROVED}`, privateKey: "0x12344" }]);
  });

  test("keeps it apart from the counterfactual address the same coordinate derives", async () => {
    const accounts = await serviceWith().recoverAccounts({
      mnemonic,
      networkId: "SN_MAIN",
      selections: [ownLadderPick, { ...ownLadderPick, address: PROVED }],
      vaultPassphrase,
    });
    expect(accounts).toHaveLength(2);
    expect(new Set(accounts.map((entry) => entry.id)).size).toBe(2);
    expect(accounts.map((entry) => entry.publicKeyX)).toEqual(["0xabc3", "0xabc3"]);
  });

  test("an imported phrase's account found by address carries that seed's handle", async () => {
    const service = serviceWith();
    await service.recoverAccounts({
      mnemonic,
      networkId: "SN_MAIN",
      selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
      vaultPassphrase,
    });
    const [imported] = await service.importSeedAccounts({
      mnemonic: otherPhrase,
      networkId: "SN_MAIN",
      selections: [{ ...ownLadderPick, address: PROVED }],
      vaultPassphrase,
    });
    expect(imported).toMatchObject({
      address: PROVED,
      derivation: { accountIndex: 3, kind: "starknet-bip44", seedId: "phrase-1" },
    });
  });

  test("refuses an address that is not canonical, or on a family the reader never matches", async () => {
    for (const selection of [
      { ...ownLadderPick, address: "0x07e57ad0e55" },
      { ...ownLadderPick, address: "0x0" },
      { accountContractType: "openzeppelin", accountIndex: 0, address: PROVED },
    ] as const) {
      await expect(
        serviceWith().recoverAccounts({
          mnemonic,
          networkId: "SN_MAIN",
          selections: [selection],
          vaultPassphrase,
        }),
      ).rejects.toThrow("Invalid recovery account selection");
    }
  });
});
