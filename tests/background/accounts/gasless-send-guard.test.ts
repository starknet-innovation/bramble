/**
 * The send path does not take a gasless ceiling from the side-panel message.
 * With the wallet flag off, a short-STRK review and a later send make no
 * paymaster request.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { PriceService } from "@bramble/portfolio/prices";
import type { GaslessFeeOffer } from "@bramble/privacy/gasless-request";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  clearGaslessSendReview,
  rememberGaslessSendReview,
  takeMatchingGaslessSend,
} from "../../../apps/extension/src/background/transactions/gasless-held-send";
import { gaslessFeeSummary } from "../../../apps/extension/src/background/transactions/gasless-review";
import { testExtension } from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const USDC = "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const tokenId = `SN_MAIN:ETH:${ETH}`;
const RECIPIENT = "0x777";
const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const offer: GaslessFeeOffer = {
  amount: "1000",
  decimals: 6,
  label: "USDC",
  tokenAddress: USDC,
};
const strkFee: FeeEstimate = { overallFee: "1000", unit: "FRI" };
const transfer = {
  accountId: account.id,
  amount: "1.5",
  recipient: RECIPIENT,
  speed: "standard" as const,
  tokenId,
};

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

const prices = (): PriceService & { readonly calls: () => number } => {
  let calls = 0;
  return {
    calls: () => calls,
    async getPrices() {
      calls += 1;
      throw new Error("prices must not be asked");
    },
    async getTokenChart() {
      calls += 1;
      throw new Error("chart must not be asked");
    },
  };
};

const withFetchCount = async (run: () => Promise<void>): Promise<number> => {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("fetch");
  }) as unknown as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return fetches;
};

beforeEach(() => clearGaslessSendReview());

describe("held gasless send", () => {
  test("a tampered echo is refused and does not consume the stored offer", () => {
    rememberGaslessSendReview({ ...transfer, offers: [offer], strkFee });
    expect(takeMatchingGaslessSend(transfer, { ...offer, decimals: 18 })).toBeNull();
    expect(takeMatchingGaslessSend(transfer, { ...offer, amount: "999999999999" })).toBeNull();
    expect(takeMatchingGaslessSend(transfer, offer)).toEqual({ offer, strkFee });
    expect(takeMatchingGaslessSend(transfer, offer)).toBeNull();
  });

  test("the activity summary names the signed fee amount", () => {
    expect(gaslessFeeSummary("Sent 1.5 ETH", { amount: "1000", decimals: 6, token: "USDC" })).toBe(
      "Sent 1.5 ETH (network fee 0.001 USDC)",
    );
  });
});

describe("gasless send messages with the flag off", () => {
  const harness = () => {
    const session = createUnlockSession();
    session.unlock("correct horse battery staple");
    const submitted: unknown[] = [];
    const feed = prices();
    const handler = createMessageHandler(walletStub, testExtension, {
      prices: feed,
      runtimeRpc: makeRuntimeRpc({
        async getTokenBalances() {
          return [
            {
              address: ETH,
              balance: "0",
              decimals: 18,
              formatted: "0",
              id: tokenId,
              name: "Ether",
              networkId: "SN_MAIN" as const,
              symbol: "ETH",
            },
          ];
        },
        async submitErc20Transfer(input) {
          submitted.push(input);
          return {
            call: { calldata: [], contractAddress: ETH, entrypoint: "transfer" },
            transactionHash: "0x7ab",
          };
        },
      }),
      session,
    });
    return { feed, handler, submitted };
  };

  test("a short-STRK review and a STRK send make no paymaster request", async () => {
    const { feed, handler, submitted } = harness();
    const fetches = await withFetchCount(async () => {
      const review = await handler(
        {
          accountId: account.id,
          amount: "1.5",
          recipient: RECIPIENT,
          tokenId,
          type: "wallet.reviewTransfer",
        },
        sender,
      );
      expect(review).toMatchObject({ ok: true });
      expect(review).not.toHaveProperty("review.gaslessFees");
      if ("review" in review && review.review) {
        expect(review.review).not.toHaveProperty("gaslessFees");
      }
      await handler(
        {
          ...transfer,
          reviewedFee: strkFee,
          type: "wallet.transfer",
        },
        sender,
      );
    });
    expect(fetches).toBe(0);
    expect(feed.calls()).toBe(0);
    expect(submitted).toHaveLength(1);
  });

  test("a tampered gasless fee is refused before any submission", async () => {
    const { handler, submitted } = harness();
    rememberGaslessSendReview({ ...transfer, offers: [offer], strkFee });
    const fetches = await withFetchCount(async () => {
      const response = await handler(
        {
          ...transfer,
          gaslessFee: { ...offer, decimals: 18 },
          reviewedFee: { overallFee: "9".repeat(40), unit: "FRI" },
          type: "wallet.transfer",
        },
        sender,
      );
      expect(response).toEqual({ error: "the fee changed since this request was reviewed" });
    });
    expect(fetches).toBe(0);
    expect(submitted).toEqual([]);
  });

  test("a matching echo still does not submit in STRK or call the paymaster", async () => {
    const { handler, submitted } = harness();
    rememberGaslessSendReview({ ...transfer, offers: [offer], strkFee });
    const fetches = await withFetchCount(async () => {
      const response = await handler(
        {
          ...transfer,
          gaslessFee: offer,
          reviewedFee: { overallFee: "9".repeat(40), unit: "FRI" },
          type: "wallet.transfer",
        },
        sender,
      );
      expect(response).toEqual({
        error: "Paying the network fee in another token is unavailable.",
      });
    });
    expect(fetches).toBe(0);
    expect(submitted).toEqual([]);
  });
});
