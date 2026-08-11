/**
 * Wallet-operation invalid-input and error-envelope branches: every RPC-backed
 * handler rejects a malformed or extra-keyed message, a locked session short
 * circuits with "wallet locked", a transfer for an absent account reports "no
 * account for selected network", the resolved signer closure actually reaches
 * the wallet, and the activity feed degrades cleanly when history is unavailable
 * behind a locked session with no pending records.
 */
import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@mc-wallet/transactions/activity";
import type { Vault } from "@mc-wallet/vault/schema";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const tokenId = `SN_MAIN:ETH:${ETH}`;

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const vaultPassphrase = "correct horse battery staple";
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const signHashCalls: string[] = [];

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
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "unused";
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
  async signHash(input: { messageHash: string }) {
    signHashCalls.push(input.messageHash);
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: false,
    };
  },
};

const rpc = {
  async estimateInvokeFee() {
    return { overallFee: "2500000000000000", unit: "FRI" };
  },
  async getDeploymentStatus() {
    return true;
  },
  async getTokenBalances() {
    return [];
  },
  async getTransactionStatuses() {
    return {};
  },
  // Submitting the transfer must exercise the resolved signer closure so it
  // reaches the wallet — that is the only path that covers signerFor's body.
  async submitErc20Transfer(input: { signHash: (hash: string) => Promise<unknown> }) {
    await input.signHash("0x1234");
    return {
      call: {
        calldata: ["0x777", "1500000000000000000", "0"],
        contractAddress: ETH,
        entrypoint: "transfer",
      },
      transactionHash: "0x7ab",
    };
  },
} as unknown as RuntimeRpc;

const makeHandler = (options?: { locked?: boolean; runtimeRpc?: RuntimeRpc }) => {
  const session = createUnlockSession();
  if (!options?.locked) {
    session.unlock(vaultPassphrase);
  }
  return createMessageHandler(walletStub, "extension-id", {
    runtimeRpc: options?.runtimeRpc ?? rpc,
    session,
  });
};

describe("wallet-ops invalid-input branches", () => {
  const cases: readonly [string, string][] = [
    ["wallet.getBalances", "invalid balances request"],
    ["wallet.deploymentStatus", "invalid deployment status request"],
    ["wallet.verifyClassHash", "invalid class hash verification request"],
    ["wallet.deployAccount", "invalid deploy account request"],
    ["wallet.activity", "invalid activity request"],
  ];

  for (const [type, error] of cases) {
    test(`rejects a ${type} message carrying extra keys`, async () => {
      const handler = makeHandler();
      // A no-payload handler accepts only { type }; the extra key fails it.
      await expect(handler({ junk: 1, type }, sender)).resolves.toEqual({ error });
    });
  }

  test("rejects a malformed reviewTransfer request", async () => {
    const handler = makeHandler();
    await expect(handler({ type: "wallet.reviewTransfer" }, sender)).resolves.toEqual({
      error: "invalid transfer review request",
    });
  });

  test("rejects a malformed transfer request", async () => {
    const handler = makeHandler();
    await expect(handler({ type: "wallet.transfer" }, sender)).resolves.toEqual({
      error: "invalid transfer request",
    });
  });
});

describe("wallet-ops error-envelope branches", () => {
  test("getBalances reports the locked error when the session is locked", async () => {
    const handler = makeHandler({ locked: true });
    await expect(handler({ type: "wallet.getBalances" }, sender)).resolves.toEqual({
      error: "wallet locked",
    });
  });

  test("a transfer while locked fails with the locked error", async () => {
    const handler = makeHandler({ locked: true });
    await expect(
      handler(
        {
          accountId: account.id,
          amount: "1",
          recipient: "0x777",
          tokenId,
          type: "wallet.transfer",
        },
        sender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("a transfer for an account absent from the vault reports no account", async () => {
    const handler = makeHandler();
    const absentId = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd0";
    await expect(
      handler(
        { accountId: absentId, amount: "1", recipient: "0x777", tokenId, type: "wallet.transfer" },
        sender,
      ),
    ).resolves.toEqual({ error: "no account for selected network" });
  });
});

describe("wallet-ops signer closure and activity feed", () => {
  test("a clean transfer drives the resolved signer through to the wallet", async () => {
    signHashCalls.length = 0;
    const handler = makeHandler();
    const response = await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
        speed: "fast",
        tokenId,
        type: "wallet.transfer",
      },
      sender,
    );
    expect(response).toEqual({ ok: true, transactionHash: "0x7ab" });
    // The signer closure ran: the wallet saw the hash the RPC layer signed.
    expect(signHashCalls).toEqual(["0x1234"]);
  });

  test("activity degrades to an empty feed when history is unavailable behind a lock", async () => {
    // No pending records (empty log) exercises the early reconcile return, and a
    // locked session makes the history scan resolve empty without a false
    // "offline" indicator even though a history source is wired.
    let historyCalls = 0;
    const historyRpc = {
      ...rpc,
      async getTransactionHistory(): Promise<readonly ActivityEntry[]> {
        historyCalls += 1;
        return [];
      },
    } as unknown as RuntimeRpc;
    const handler = makeHandler({ locked: true, runtimeRpc: historyRpc });

    const response = await handler({ type: "wallet.activity" }, sender);
    expect(response).toEqual({ activity: [], ok: true });
    // The scan is skipped entirely once the account context fails to resolve.
    expect(historyCalls).toBe(0);
  });
});
