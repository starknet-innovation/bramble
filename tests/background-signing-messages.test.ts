/**
 * Background signing message checks prove hash signing stays privileged and typed.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import type { AccountRef } from "../src/storage/vault-schema";
import type { SignHashInput, WalletStatus } from "../src/wallet/vault-service";

const account: AccountRef = {
  address: "0xabcabcdef",
  classHash: "0xabcdef",
  derivation: {
    accountIndex: 0,
    addressIndex: 0,
    kind: "starknet-bip44",
  },
  id: "SN_SEPOLIA:0xabcabcdef",
  networkId: "SN_SEPOLIA",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/popup.html",
};
const vaultPassphrase = "correct horse battery staple";
const status: WalletStatus = {
  accountCount: 1,
  activeAccountId: account.id,
  hasVault: true,
  locked: true,
  ready: true,
};

const createSigningWallet = (captureSign?: (input: SignHashInput) => void) => ({
  async createAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [];
  },
  async grantOrigin() {
    return [account];
  },
  async readVault(passphrase: string) {
    if (passphrase !== vaultPassphrase) {
      throw new Error("bad passphrase");
    }
    return {
      accounts: [account],
      activeAccountId: account.id,
      originGrants: [{ accountIds: [account.id], origin: "https://example.com" }],
      schemaVersion: 1 as const,
      signingKeys: [{ accountId: account.id, privateKey: "0x123456" }],
    };
  },
  async signHash(input: SignHashInput) {
    captureSign?.(input);
    return {
      publicKey: "0xabc",
      r: "0x1",
      s: "0x2",
    };
  },
  async status() {
    return status;
  },
});

describe("background signing messages", () => {
  test("validates sign hash messages", async () => {
    const captured: SignHashInput[] = [];
    const handler = createMessageHandler(
      createSigningWallet((input) => captured.push(input)),
      "extension-id",
    );

    await expect(
      handler(
        {
          messageHash: "not-hex",
          type: "wallet.signHash",
          vaultPassphrase,
        },
        sender,
      ),
    ).resolves.toEqual({ error: "invalid sign hash request" });
    await expect(
      handler(
        {
          messageHash: "0x800000000000011000000000000000000000000000000000000000000000001",
          type: "wallet.signHash",
          vaultPassphrase,
        },
        sender,
      ),
    ).resolves.toEqual({ error: "invalid sign hash request" });
    expect(captured).toEqual([]);
  });

  test("signs hashes through the wallet service only", async () => {
    const captured: SignHashInput[] = [];
    const handler = createMessageHandler(
      createSigningWallet((input) => captured.push(input)),
      "extension-id",
    );

    await expect(
      handler(
        {
          accountId: account.id,
          messageHash: "0x1234",
          type: "wallet.signHash",
          vaultPassphrase,
        },
        sender,
      ),
    ).resolves.toEqual({
      ok: true,
      signature: {
        publicKey: "0xabc",
        r: "0x1",
        s: "0x2",
      },
    });
    expect(captured[0]?.messageHash).toBe("0x1234");
  });
});
