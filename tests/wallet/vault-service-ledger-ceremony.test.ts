/**
 * The Ledger STRK20 viewing-key ceremony. The device cannot reveal its private
 * key, so the wallet hashes the scope, has the device sign that exact message,
 * and folds the returned `(r, s)` into the key — all inside the vault boundary.
 *
 * These pin the properties that make it safe: the device is asked to sign the
 * message the software derivation would have signed for that exact scope, the
 * stored key is the fold of what the device returned, nothing is written when the
 * device refuses, the result is readable afterwards by the ordinary derivation
 * path, and a software account cannot reach the ceremony at all.
 */
import { describe, expect, test } from "bun:test";
import { createEncryptedStore } from "../../src/storage/encrypted-store";
import { createMemoryStore } from "../../src/storage/kv";
import { createWalletVaultService } from "../../src/wallet/vault-service";
import { fakeKms } from "../support/fake-kms";

const vaultKey = "mc-wallet:vault";
const migrationKey = "mc-wallet:vault-migration";
const vaultPassphrase = "correct horse battery staple";
const CHAIN_MAIN = "0x534e5f4d41494e";
const POOL = "0x123";

const makeService = (store = createMemoryStore()) => ({
  service: createWalletVaultService({
    encryptedStore: createEncryptedStore(store, vaultKey),
    kms: fakeKms(),
    migrationStore: createEncryptedStore(store, migrationKey),
  }),
  store,
});

const ledgerVault = async () => {
  const { service, store } = makeService();
  const account = await service.createLedgerVault({
    accountIndex: 0,
    networkId: "SN_MAIN",
    publicKeyX: "0xdef123",
    vaultPassphrase,
  });
  return { account, service, store };
};

// The fake KMS models both stages as pure functions of their inputs, so the
// expected key can be recomputed here without reimplementing any crypto.
const expectedKey = async (r: string, s: string): Promise<string> =>
  fakeKms().foldStrk20ViewingKey(r, s);
const expectedHash = async (chainId: string, poolAddress: string): Promise<string> =>
  fakeKms().strk20ViewingKeyMessageHash(chainId, poolAddress);

describe("deriveLedgerStrk20ViewingKey", () => {
  test("signs the scope's message and retains the fold of the device signature", async () => {
    const { account, service } = await ledgerVault();
    const signed: string[] = [];

    await service.deriveLedgerStrk20ViewingKey({
      accountId: account.id,
      chainId: CHAIN_MAIN,
      poolAddress: POOL,
      sign: async (messageHash) => {
        signed.push(messageHash);
        return { publicKey: "0xdef123", r: "0x11", s: "0x22" };
      },
      vaultPassphrase,
    });

    // The device saw exactly the scope's message — not a hash of something else.
    expect(signed).toEqual([await expectedHash(CHAIN_MAIN, POOL)]);
    // And the retained key is the fold of what the device returned, readable
    // afterwards through the ordinary derivation path.
    await expect(
      service.deriveStrk20ViewingKey({
        accountId: account.id,
        chainId: CHAIN_MAIN,
        poolAddress: POOL,
        vaultPassphrase,
      }),
    ).resolves.toBe(await expectedKey("0x11", "0x22"));
  });

  test("a device refusal writes nothing and leaves the account without a key", async () => {
    const { account, service } = await ledgerVault();

    await expect(
      service.deriveLedgerStrk20ViewingKey({
        accountId: account.id,
        chainId: CHAIN_MAIN,
        poolAddress: POOL,
        sign: async () => {
          throw new Error("rejected-on-device");
        },
        vaultPassphrase,
      }),
    ).rejects.toThrow("rejected-on-device");

    await expect(
      service.deriveStrk20ViewingKey({
        accountId: account.id,
        chainId: CHAIN_MAIN,
        poolAddress: POOL,
        vaultPassphrase,
      }),
    ).rejects.toThrow("Ledger STRK20 viewing key unavailable");
  });

  test("scopes the retained key to its own pool and replaces only that scope", async () => {
    const { account, service } = await ledgerVault();
    const run = (poolAddress: string, r: string) =>
      service.deriveLedgerStrk20ViewingKey({
        accountId: account.id,
        chainId: CHAIN_MAIN,
        poolAddress,
        sign: async () => ({ publicKey: "0xdef123", r, s: "0x22" }),
        vaultPassphrase,
      });
    const read = (poolAddress: string) =>
      service.deriveStrk20ViewingKey({
        accountId: account.id,
        chainId: CHAIN_MAIN,
        poolAddress,
        vaultPassphrase,
      });

    await run(POOL, "0x11");
    await run("0x456", "0x33");
    expect(await read(POOL)).toBe(await expectedKey("0x11", "0x22"));
    expect(await read("0x456")).toBe(await expectedKey("0x33", "0x22"));

    // Re-running one scope replaces that key and leaves the sibling pool alone.
    await run(POOL, "0x44");
    expect(await read(POOL)).toBe(await expectedKey("0x44", "0x22"));
    expect(await read("0x456")).toBe(await expectedKey("0x33", "0x22"));
  });

  test("refuses a chain that is not the account's own network", async () => {
    const { account, service } = await ledgerVault();
    let asked = false;

    await expect(
      service.deriveLedgerStrk20ViewingKey({
        accountId: account.id,
        // Sepolia's chain id against a mainnet account.
        chainId: "0x534e5f5345504f4c4941",
        poolAddress: POOL,
        sign: async () => {
          asked = true;
          return { publicKey: "0xdef123", r: "0x11", s: "0x22" };
        },
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid Ledger STRK20 viewing-key scope");
    // The scope is rejected before the device is ever prompted, so a wrong-chain
    // request cannot spend a user's device confirmation.
    expect(asked).toBe(false);
  });

  test("normalizes a padded pool address to the same scope and key", async () => {
    const { account, service } = await ledgerVault();
    const signed: string[] = [];

    // `0x0123` and `0x123` are the same pool. The scope is canonicalized before
    // hashing, so both must sign the same message and land on the same key —
    // deriving two keys for one pool would strand notes under the unused one.
    await service.deriveLedgerStrk20ViewingKey({
      accountId: account.id,
      chainId: CHAIN_MAIN,
      poolAddress: "0x0123",
      sign: async (messageHash) => {
        signed.push(messageHash);
        return { publicKey: "0xdef123", r: "0x11", s: "0x22" };
      },
      vaultPassphrase,
    });

    expect(signed).toEqual([await expectedHash(CHAIN_MAIN, POOL)]);
    // Readable under the canonical spelling, which is what the pool sees.
    await expect(
      service.deriveStrk20ViewingKey({
        accountId: account.id,
        chainId: CHAIN_MAIN,
        poolAddress: POOL,
        vaultPassphrase,
      }),
    ).resolves.toBe(await expectedKey("0x11", "0x22"));
  });

  test("refuses a software account, which derives through Krusty instead", async () => {
    const { service } = makeService();
    const account = await service.createAccount({
      mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
      networkId: "SN_MAIN",
      vaultPassphrase,
    });

    await expect(
      service.deriveLedgerStrk20ViewingKey({
        accountId: account.id,
        chainId: CHAIN_MAIN,
        poolAddress: POOL,
        sign: async () => ({ publicKey: "0xabc", r: "0x11", s: "0x22" }),
        vaultPassphrase,
      }),
    ).rejects.toThrow("Account is not a Ledger account");
  });

  test("never writes the retained key outside the encrypted vault", async () => {
    const { account, service, store } = await ledgerVault();
    await service.deriveLedgerStrk20ViewingKey({
      accountId: account.id,
      chainId: CHAIN_MAIN,
      poolAddress: POOL,
      sign: async () => ({ publicKey: "0xdef123", r: "0x11", s: "0x22" }),
      vaultPassphrase,
    });

    const key = await expectedKey("0x11", "0x22");
    const serialized = JSON.stringify(await store.get(vaultKey));
    expect(serialized).not.toContain(key);
    expect(serialized).not.toContain(key.slice(2));
  });
});
