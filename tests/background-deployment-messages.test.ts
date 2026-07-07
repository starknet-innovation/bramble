/**
 * Background deployment message checks: status reads and DEPLOY_ACCOUNT
 * submissions stay privileged, locked-safe, and scoped to the active network.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { DeployAccountInput, DeploymentStatusInput } from "../src/starknet/rpc";
import type { AccountRef, Vault } from "../src/storage/vault-schema";

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

const makeHandler = (unlocked: boolean) => {
  const statusCalls: DeploymentStatusInput[] = [];
  const deployCalls: DeployAccountInput[] = [];
  const session = createUnlockSession();
  if (unlocked) {
    session.unlock(vaultPassphrase);
  }
  const handler = createMessageHandler(walletStub, "extension-id", session, undefined, undefined, {
    async estimateInvokeFee() {
      return { overallFee: "1", unit: "FRI" };
    },
    async getDeploymentStatus(input) {
      statusCalls.push(input);
      return false;
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
    async submitAccountDeployment(input) {
      deployCalls.push(input);
      return { transactionHash: "0x7abc" };
    },
    async submitErc20Transfer() {
      throw new Error("unused");
    },
    async submitInvokeTransaction() {
      throw new Error("unused");
    },
  });
  return { deployCalls, handler, statusCalls };
};

describe("background deployment messages", () => {
  test("requires an extension page sender", async () => {
    const { handler } = makeHandler(true);
    expect(await handler({ type: "wallet.deploymentStatus" }, contentSender)).toEqual({
      error: "privileged sender required",
    });
    expect(await handler({ type: "wallet.deployAccount" }, contentSender)).toEqual({
      error: "privileged sender required",
    });
  });

  test("requires an unlocked vault", async () => {
    const { handler } = makeHandler(false);
    expect(await handler({ type: "wallet.deploymentStatus" }, extensionSender)).toEqual({
      error: "wallet locked",
    });
    expect(await handler({ type: "wallet.deployAccount" }, extensionSender)).toEqual({
      error: "wallet locked",
    });
  });

  test("reports the active account deployment status for the active network", async () => {
    const { handler, statusCalls } = makeHandler(true);
    const response = await handler({ type: "wallet.deploymentStatus" }, extensionSender);

    expect(response).toEqual({ accountId: account.id, deployed: false, ok: true });
    expect(statusCalls).toEqual([
      {
        accountAddress: account.address,
        rpcUrls: ["https://api.cartridge.gg/x/starknet/mainnet"],
      },
    ]);
  });

  test("submits a deployment for the active account and returns its hash", async () => {
    const { deployCalls, handler } = makeHandler(true);
    const response = await handler({ type: "wallet.deployAccount" }, extensionSender);

    expect(response).toEqual({ ok: true, transactionHash: "0x7abc" });
    expect(deployCalls).toHaveLength(1);
    expect(deployCalls[0]?.account).toEqual(account);
    expect(typeof deployCalls[0]?.signHash).toBe("function");
  });
});
