/**
 * Background class-hash verification message: stays privileged and locked-safe,
 * verifies the active account's advertised class hash against the active
 * network's RPC endpoints, and fails closed when the verification surface is
 * unavailable rather than implying a trusted result.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { VerifyClassHashInput } from "../src/starknet/class-hash-verify";
import type { AccountRef, Vault } from "../src/storage/vault-schema";
import { makeRuntimeRpc } from "./support/runtime-rpc-stub";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://example.com/app" };
const vaultPassphrase = "correct horse battery staple";

const vault = {
  accounts: [account],
  activeAccountId: account.id,
} as unknown as Vault;

const walletStub = {
  async createAccount() {
    return account;
  },
  async addDerivedAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return vault;
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: "0x3", r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

const VERIFY = { type: "wallet.verifyClassHash" } as const;

describe("background class-hash verification message", () => {
  test("requires an extension page sender", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, "extension-id", {
      runtimeRpc: makeRuntimeRpc(),
      session,
    });
    expect(await handler(VERIFY, contentSender)).toEqual({ error: "privileged sender required" });
  });

  test("requires an unlocked vault", async () => {
    const handler = createMessageHandler(walletStub, "extension-id", {
      runtimeRpc: makeRuntimeRpc(),
      session: createUnlockSession(),
    });
    expect(await handler(VERIFY, extensionSender)).toEqual({ error: "wallet locked" });
  });

  test("verifies the active account's advertised class hash on the active network", async () => {
    const calls: VerifyClassHashInput[] = [];
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, "extension-id", {
      runtimeRpc: makeRuntimeRpc({
        async verifyAccountClassHash(input) {
          calls.push(input);
          return { onChainClassHash: account.classHash, status: "verified" };
        },
      }),
      session,
    });

    const response = await handler(VERIFY, extensionSender);

    expect(response).toEqual({
      accountId: account.id,
      ok: true,
      verification: { onChainClassHash: account.classHash, status: "verified" },
    });
    expect(calls).toEqual([
      {
        accountAddress: account.address,
        expectedClassHash: account.classHash,
        rpcUrls: ["https://api.cartridge.gg/x/starknet/mainnet"],
      },
    ]);
  });

  test("surfaces a mismatch verdict without rewriting it", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, "extension-id", {
      runtimeRpc: makeRuntimeRpc({
        async verifyAccountClassHash() {
          return {
            expectedClassHash: account.classHash,
            onChainClassHash: "0x9999",
            status: "mismatch",
          };
        },
      }),
      session,
    });

    expect(await handler(VERIFY, extensionSender)).toEqual({
      accountId: account.id,
      ok: true,
      verification: {
        expectedClassHash: account.classHash,
        onChainClassHash: "0x9999",
        status: "mismatch",
      },
    });
  });

  test("rejects an unexpected extra field on the request", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, "extension-id", {
      runtimeRpc: makeRuntimeRpc(),
      session,
    });
    expect(await handler({ extra: true, type: "wallet.verifyClassHash" }, extensionSender)).toEqual(
      { error: "invalid class hash verification request" },
    );
  });

  test("fails closed when the verification surface is unavailable", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    // The optional method is absent on a partial stub; the handler must not
    // treat that as a passing verification.
    const runtimeRpc = makeRuntimeRpc();
    delete (runtimeRpc as { verifyAccountClassHash?: unknown }).verifyAccountClassHash;
    const handler = createMessageHandler(walletStub, "extension-id", {
      runtimeRpc,
      session,
    });
    expect(await handler(VERIFY, extensionSender)).toEqual({
      error: "class hash verification unavailable",
    });
  });

  // Cross-feature seam (#112 raw-key import ↔ #110 class-hash verify): a
  // raw-key-imported account is an ImportedAccountRef with NO `publicKeyY`. The
  // verify path resolves the active account and reads its address/classHash, so
  // an imported account must verify on-chain exactly like a derived one. This
  // drives the real handler with an imported account active to lock in that the
  // shared active-account context accepts both account variants.
  test("verifies an imported (publicKeyY-less) account like a derived one", async () => {
    const importedAccount: AccountRef = {
      address: "0x5abc567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
      classHash: "0x6abc567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
      derivation: { kind: "imported-raw-key" },
      id: "SN_MAIN:0x5abc567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
      networkId: "SN_MAIN",
      publicKeyX: "0x7abc567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
    };
    // Guard the premise: this really is the publicKeyY-less variant.
    expect(importedAccount).not.toHaveProperty("publicKeyY");

    const importedVault = {
      accounts: [importedAccount],
      activeAccountId: importedAccount.id,
    } as unknown as Vault;
    const importedWalletStub = {
      ...walletStub,
      async readVault() {
        return importedVault;
      },
      async status() {
        return {
          accountCount: 1,
          activeAccountId: importedAccount.id,
          hasVault: true,
          locked: false,
          ready: true,
        };
      },
    };

    const calls: VerifyClassHashInput[] = [];
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(importedWalletStub, "extension-id", {
      runtimeRpc: makeRuntimeRpc({
        async verifyAccountClassHash(input) {
          calls.push(input);
          return { onChainClassHash: importedAccount.classHash, status: "verified" };
        },
      }),
      session,
    });

    const response = await handler(VERIFY, extensionSender);

    expect(response).toEqual({
      accountId: importedAccount.id,
      ok: true,
      verification: { onChainClassHash: importedAccount.classHash, status: "verified" },
    });
    // The imported account's own address/classHash reach the verifier unchanged.
    expect(calls).toEqual([
      {
        accountAddress: importedAccount.address,
        expectedClassHash: importedAccount.classHash,
        rpcUrls: ["https://api.cartridge.gg/x/starknet/mainnet"],
      },
    ]);
  });
});
