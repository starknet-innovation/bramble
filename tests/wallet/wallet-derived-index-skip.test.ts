/**
 * A raw-key import of the wallet's own HD key does not block later accounts
 * (Sherlock 226).
 *
 * The imported account has the same id as the HD account derived from that
 * key, but it holds no HD position, so the next free index still pointed at
 * it and every later "Regular account" on that network failed with "Account
 * already exists". The wallet now skips an index whose derived account is
 * already stored and takes the next one.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createWalletVaultService } from "@bramble/vault/service";
import { ec } from "starknet";

const vaultPassphrase = "correct horse battery staple";
const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
// Clearly-fake test vectors, one per HD index; not real keys.
const keyAt = (accountIndex: number): string => `0xfeed${(accountIndex + 1).toString(16)}`;

// A KMS whose HD ladder and raw-key import agree, as Krusty's do: the key at
// an index imports to the same public key, so the same account id.
const ladderKms = () => ({
  ...fakeKms(),
  async deriveOzAccountAddress(publicKeyX: string, classHash: string) {
    return `0x${publicKeyX.slice(-16)}${classHash.slice(-6)}`;
  },
  async deriveStarknetKeypair(_mnemonic: string, _addressIndex: number, accountIndex: number) {
    const privateKey = keyAt(accountIndex);
    const point = ec.starkCurve.ProjectivePoint.fromPrivateKey(BigInt(privateKey)).toAffine();
    return {
      privateKey,
      publicKeyX: `0x${point.x.toString(16)}`,
      publicKeyY: `0x${point.y.toString(16)}`,
    };
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

const newService = () =>
  createWalletVaultService({
    encryptedStore: createEncryptedStore(createMemoryStore(), "bramble:vault"),
    kms: ladderKms(),
    migrationStore: createEncryptedStore(createMemoryStore(), "bramble:vault-migration"),
  });

const add = { accountContractType: "openzeppelin", networkId: "SN_MAIN", vaultPassphrase } as const;

describe("addDerivedAccount after importing the wallet's own key", () => {
  test("skips the index the import already holds and keeps adding accounts", async () => {
    const service = newService();
    const first = await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      networkId: "SN_MAIN",
      vaultPassphrase,
    });
    const imported = await service.importRawKeyAccount({ ...add, privateKey: keyAt(1) });

    const second = await service.addDerivedAccount(add);
    const third = await service.addDerivedAccount(add);

    expect(first.derivation).toMatchObject({ accountIndex: 0, kind: "starknet-bip44" });
    expect(second.derivation).toMatchObject({ accountIndex: 2, kind: "starknet-bip44" });
    expect(third.derivation).toMatchObject({ accountIndex: 3, kind: "starknet-bip44" });
    const ids = (await service.readVault(vaultPassphrase)).accounts.map((account) => account.id);
    expect(ids).toEqual([first.id, imported.id, second.id, third.id]);
  });

  test("leaves the ladder unchanged when nothing collides", async () => {
    const service = newService();
    await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      networkId: "SN_MAIN",
      vaultPassphrase,
    });
    const second = await service.addDerivedAccount(add);
    expect(second.derivation).toMatchObject({ accountIndex: 1 });
  });
});
