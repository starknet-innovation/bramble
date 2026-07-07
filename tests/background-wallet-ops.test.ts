/**
 * Wallet operations checks: the pre-sign review carries verification output
 * and fees, transfers are recorded in the activity feed, and the feed
 * refreshes pending statuses per network.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import { createActivityLog } from "../src/storage/activity-store";
import { createMemoryStore } from "../src/storage/kv";
import type { AccountRef, Vault } from "../src/storage/vault-schema";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

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
const vaultPassphrase = "correct horse battery staple";
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const tokenId = `SN_MAIN:ETH:${ETH}`;

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
    return [account];
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

const makeHarness = (options?: { readonly deployed?: boolean }) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  let tick = 0;
  const activity = createActivityLog({
    now: () => {
      tick += 1000;
      return tick;
    },
    store: createMemoryStore(),
  });
  const statusRequests: string[][] = [];
  const handler = createMessageHandler(
    walletStub,
    "extension-id",
    session,
    undefined,
    undefined,
    {
      async estimateInvokeFee() {
        return { overallFee: "2500000000000000", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return options?.deployed ?? true;
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
      async getTransactionStatuses({ hashes }) {
        statusRequests.push([...hashes]);
        return Object.fromEntries(hashes.map((hash) => [hash, "accepted" as const]));
      },
      async submitAccountDeployment() {
        return { transactionHash: "0x7de" };
      },
      async submitErc20Transfer() {
        return {
          call: {
            calldata: ["0x777", "1500000000000000000", "0"],
            contractAddress: ETH,
            entrypoint: "transfer",
          },
          transactionHash: "0x7ab",
        };
      },
      async submitInvokeTransaction() {
        return { calls: [], transactionHash: "0x7cd" };
      },
    },
    activity,
  );
  return { activity, handler, statusRequests };
};

describe("wallet operations", () => {
  test("review returns decoded summaries, flags, and the fee estimate", async () => {
    const { handler } = makeHarness();
    const response = await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: account.address,
        tokenId,
        type: "wallet.reviewTransfer",
      },
      extensionSender,
    );

    expect(response).toMatchObject({
      ok: true,
      review: {
        fee: { overallFee: "2500000000000000", unit: "FRI" },
        requiresDeployment: false,
      },
    });
    const review = (
      response as { review: { flags: readonly { code: string }[]; summaries: readonly string[] } }
    ).review;
    expect(review.summaries[0]).toContain("Send 1.5 ETH");
    expect(review.flags.map((flag) => flag.code)).toContain("self-transfer");
  });

  test("review reports required deployment instead of a fee when undeployed", async () => {
    const { handler } = makeHarness({ deployed: false });
    const response = await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
        tokenId,
        type: "wallet.reviewTransfer",
      },
      extensionSender,
    );

    expect(response).toMatchObject({ ok: true, review: { fee: null, requiresDeployment: true } });
  });

  test("transfers are recorded and the activity feed refreshes their status", async () => {
    const { handler, statusRequests } = makeHarness();
    await handler(
      {
        accountId: account.id,
        amount: "1.5",
        recipient: "0x777",
        speed: "fast",
        tokenId,
        type: "wallet.transfer",
      },
      extensionSender,
    );

    const response = await handler({ type: "wallet.activity" }, extensionSender);
    expect(response).toMatchObject({ ok: true });
    const activity = (
      response as { activity: readonly { hash: string; status: string; summary: string }[] }
    ).activity;
    expect(activity).toHaveLength(1);
    expect(activity[0]?.hash).toBe("0x7ab");
    expect(activity[0]?.status).toBe("accepted");
    expect(activity[0]?.summary).toContain("Send 1.5 ETH");
    expect(statusRequests).toEqual([["0x7ab"]]);
  });
});
