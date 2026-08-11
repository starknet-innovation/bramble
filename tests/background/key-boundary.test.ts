/**
 * Key-boundary regression: no runtime message response may ever carry key
 * material out of the background. The stub vault is salted with recognizable
 * secrets; every handled message's serialized response is scanned for them,
 * and the scanned catalog is proven exhaustive against the message types the
 * background sources actually handle.
 */
import { describe, expect, test } from "bun:test";
import type { Vault } from "@mc-wallet/vault/schema";
import { createMessageHandler } from "../../apps/extension/src/background/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/senders";
import { createUnlockSession } from "../../apps/extension/src/background/session";
import {
  account,
  contentSender,
  extensionSender,
  handledWalletMessages,
  KEY_BOUNDARY_MESSAGES,
  SECRET_MNEMONIC,
  SECRET_PASSPHRASE,
  SECRET_PRIVATE_KEY,
  SECRET_VIEWING_KEY,
} from "../support/key-boundary-messages";

const vault = {
  accounts: [account],
  accountSecrets: [
    {
      accountId: account.id,
      ledgerStrk20ViewingKeys: [
        {
          chainId: "0x534e5f4d41494e",
          poolAddress: "0x123",
          scheme: "ledger-strk20-typed-data-v1",
          viewingKey: SECRET_VIEWING_KEY,
        },
      ],
    },
  ],
  activeAccountId: account.id,
  mnemonic: SECRET_MNEMONIC,
  originGrants: [{ accountIds: [account.id], origin: "https://dapp.example" }],
  schemaVersion: 4,
  signingKeys: [{ accountId: account.id, privateKey: SECRET_PRIVATE_KEY }],
} as unknown as Vault;

const walletStub = {
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async importRawKeyAccount() {
    return account;
  },
  async previewAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return SECRET_MNEMONIC;
  },
  async grantOrigin() {
    return [account];
  },
  async readVault(passphrase: string) {
    if (passphrase !== SECRET_PASSPHRASE) {
      throw new Error("bad passphrase");
    }
    return vault;
  },
  async revokeOrigin() {
    return [];
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
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

const runtimeRpcStub = {
  async estimateInvokeFee() {
    return { overallFee: "1", unit: "FRI" };
  },
  async getDeploymentStatus() {
    return false;
  },
  async getNftOwner() {
    return "0x0";
  },
  async getTokenBalances() {
    return [];
  },
  async getTokenMetadata() {
    return { decimals: 18, name: "Token", symbol: "TKN" };
  },
  async getTransactionStatuses() {
    return {};
  },
  async submitDeclareTransaction() {
    return { classHash: "0x1", transactionHash: "0x1" };
  },
  async submitAccountDeployment() {
    return { transactionHash: "0x7abc" };
  },
  async submitErc20Transfer() {
    return {
      call: { calldata: [], contractAddress: "0x1", entrypoint: "transfer" },
      transactionHash: "0x7abc",
    };
  },
  async submitInvokeTransaction() {
    return { calls: [], transactionHash: "0x7abc" };
  },
  multisig: {
    async computeTransactionId() {
      return "0xabc";
    },
    async getConfig() {
      return { quorum: 1, signers: [account.address] };
    },
    async getProposalStatus() {
      return { confirmations: 0, confirmedBySigner: false, state: "pending" as const };
    },
    async isClassDeclared() {
      return true;
    },
  },
};

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe("key boundary", () => {
  test("the scan catalog covers every message type the background handles", async () => {
    const handled = await handledWalletMessages();
    const scanned = new Set(
      KEY_BOUNDARY_MESSAGES.map((entry) => String(entry.message["type"] ?? "")),
    );
    const missing = [...handled].filter((type) => !scanned.has(type)).sort();
    // A non-empty list means a message type was added to the background
    // without a key-boundary scan entry: add a payload for it to
    // tests/support/key-boundary-messages.ts.
    expect(missing).toEqual([]);
  });

  test("no handled message response ever carries key material", async () => {
    const session = createUnlockSession();
    session.unlock(SECRET_PASSPHRASE);
    const handler = createMessageHandler(walletStub, "extension-id", {
      runtimeRpc: runtimeRpcStub,
      session,
    });

    // State-changing dapp methods (invoke, switchChain, signTypedData) hold their
    // response until approved. Fire the request, approve any approval it queues,
    // then scan the settled response — the held result must also carry no secret.
    const settle = async (
      message: Record<string, unknown>,
      sender: RuntimeSender,
    ): Promise<unknown> => {
      const held = handler(message, sender);
      const outcome = held.then(
        (value) => ({ ok: true as const, value }),
        (cause: unknown) => ({ cause, ok: false as const }),
      );
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const settled = await Promise.race([outcome, flush().then(() => null)]);
        if (settled !== null) {
          if (!settled.ok) {
            throw settled.cause;
          }
          return settled.value;
        }
        const listed = (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
          readonly pending?: readonly { readonly id: string }[];
        };
        const pending = listed.pending ?? [];
        for (const approval of pending) {
          await handler({ id: approval.id, type: "wallet.approveOrigin" }, extensionSender);
        }
      }
      throw new Error(`wallet message did not settle: ${String(message["type"] ?? "unknown")}`);
    };

    for (const { message, sender } of KEY_BOUNDARY_MESSAGES) {
      const response = await settle(message, sender);
      const serialized = JSON.stringify(response);
      const sanctionedReveal =
        message["type"] === "wallet.generateMnemonic" || message["type"] === "wallet.revealSecrets";
      expect(serialized).not.toContain(SECRET_PASSPHRASE);
      expect(serialized).not.toContain("signingKeys");
      expect(serialized).not.toContain("accountSecrets");
      expect(serialized).not.toContain(SECRET_VIEWING_KEY);
      if (message["type"] !== "wallet.revealSecrets") {
        expect(serialized).not.toContain(SECRET_PRIVATE_KEY);
      }
      if (!sanctionedReveal) {
        expect(serialized).not.toContain(SECRET_MNEMONIC);
      }
    }
  });

  test("mnemonic generation reveals only to extension pages", async () => {
    const session = createUnlockSession();
    const handler = createMessageHandler(walletStub, "extension-id", {
      runtimeRpc: runtimeRpcStub,
      session,
    });

    expect(await handler({ type: "wallet.generateMnemonic" }, contentSender)).toEqual({
      error: "privileged sender required",
    });
    expect(await handler({ type: "wallet.generateMnemonic" }, extensionSender)).toEqual({
      mnemonic: SECRET_MNEMONIC,
      ok: true,
    });
  });

  test("reveal secrets require an extension page and the re-entered passphrase", async () => {
    const session = createUnlockSession();
    const handler = createMessageHandler(walletStub, "extension-id", {
      runtimeRpc: runtimeRpcStub,
      session,
    });

    expect(
      await handler(
        { type: "wallet.revealSecrets", vaultPassphrase: SECRET_PASSPHRASE },
        contentSender,
      ),
    ).toEqual({ error: "privileged sender required" });
    expect(
      await handler(
        { type: "wallet.revealSecrets", vaultPassphrase: "wrong passphrase!!" },
        extensionSender,
      ),
    ).toEqual({ error: "bad passphrase" });
    expect(
      await handler(
        { type: "wallet.revealSecrets", vaultPassphrase: SECRET_PASSPHRASE },
        extensionSender,
      ),
    ).toEqual({ mnemonic: SECRET_MNEMONIC, ok: true, privateKey: SECRET_PRIVATE_KEY });
  });
});
