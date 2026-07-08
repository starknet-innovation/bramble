/**
 * Allowance manager message checks: approvals submitted through the dapp invoke
 * path are recorded, listed, and revoked with a zero-amount approve through the
 * verified send path.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import { memoryAllowanceStore } from "../src/storage/allowance-store";
import type { AccountRef, Vault } from "../src/storage/vault-schema";
import { flushHeld, latestApprovalId } from "./support/held";

const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
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
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://dapp.example/app" };

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
  async signHash() {
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

const makeHarness = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const allowanceStore = memoryAllowanceStore();
  const invokeCalls: (readonly unknown[])[] = [];
  const handler = createMessageHandler(
    walletStub,
    "extension-id",
    session,
    undefined,
    undefined,
    {
      async estimateInvokeFee() {
        return { overallFee: "1", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return true;
      },
      async getNftOwner() {
        return account.address;
      },
      async getTokenBalances() {
        return [];
      },
      async getTokenMetadata() {
        return { decimals: 18, name: "Ether", symbol: "ETH" };
      },
      async getTransactionStatuses() {
        return {};
      },
      async submitAccountDeployment() {
        return { transactionHash: "0x7de" };
      },
      async submitErc20Transfer() {
        return {
          call: { calldata: [], contractAddress: TOKEN, entrypoint: "transfer" },
          transactionHash: "0x7ab",
        };
      },
      async submitInvokeTransaction(input) {
        invokeCalls.push(input.calls);
        return { calls: input.calls, transactionHash: "0x7cd" };
      },
    },
    undefined,
    undefined,
    undefined,
    allowanceStore,
  );
  return { allowanceStore, handler, invokeCalls };
};

// A dapp invoke is now held behind an approval; approving it runs the held
// calls through the wallet, which is where allowances get recorded.
const submitApprove = async (handler: ReturnType<typeof makeHarness>["handler"]) => {
  const held = handler(
    {
      calls: [{ calldata: ["0x5", "1000", "0"], contractAddress: TOKEN, entrypoint: "approve" }],
      origin: "https://dapp.example",
      type: "wallet.addInvokeTransaction",
    },
    contentSender,
  );
  await flushHeld();
  const id = await latestApprovalId(handler, extensionSender);
  await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
  return held;
};

describe("allowance manager messages", () => {
  test("records approvals submitted through the dapp invoke path", async () => {
    const { handler } = makeHarness();
    await submitApprove(handler);

    const response = await handler({ type: "wallet.allowances" }, extensionSender);
    expect(response).toMatchObject({ ok: true });
    const allowances = (response as { allowances: readonly { amount: string; spender: string }[] })
      .allowances;
    expect(allowances).toHaveLength(1);
    expect(allowances[0]).toMatchObject({ amount: "1000", spender: "0x5" });
  });

  test("requires an extension page to list allowances", async () => {
    const { handler } = makeHarness();
    await expect(handler({ type: "wallet.allowances" }, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("revokes a tracked allowance with a zero-amount approve", async () => {
    const { handler, invokeCalls } = makeHarness();
    await submitApprove(handler);
    const listed = (await handler({ type: "wallet.allowances" }, extensionSender)) as {
      allowances: readonly { id: string }[];
    };
    const id = listed.allowances[0]?.id ?? "";

    const revoke = await handler({ id, type: "wallet.revokeAllowance" }, extensionSender);
    expect(revoke).toEqual({ ok: true, transactionHash: "0x7cd" });

    const revokeCall = invokeCalls.at(-1)?.[0] as { calldata: string[]; entrypoint: string };
    expect(revokeCall.entrypoint).toBe("approve");
    expect(revokeCall.calldata).toEqual(["5", "0", "0"]);

    const after = (await handler({ type: "wallet.allowances" }, extensionSender)) as {
      allowances: readonly unknown[];
    };
    expect(after.allowances).toEqual([]);
  });

  test("rejects revoking an unknown allowance", async () => {
    const { handler } = makeHarness();
    await expect(
      handler({ id: "SN_MAIN:0x1:0x2", type: "wallet.revokeAllowance" }, extensionSender),
    ).resolves.toEqual({ error: "allowance not found" });
  });
});
