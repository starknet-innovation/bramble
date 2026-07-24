/**
 * Background swap-operation checks: quotes come back as display-ready views,
 * execution enforces the approve-only-sell-token policy before anything is
 * signed, results land in the activity feed, and every failure path (locked
 * wallet, bad input, aggregator errors) fails closed with an error response.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../src/background/messages";
import type { RuntimeSender } from "../../src/background/senders";
import { createUnlockSession } from "../../src/background/session";
import type { SwapCall, SwapService } from "../../src/starknet/avnu";
import { DEFAULT_TOKENS, STARKNET_NETWORKS } from "../../src/starknet/networks";
import { createActivityLog } from "../../src/storage/activity-store";

const mainnetToken = (symbol: string): string =>
  DEFAULT_TOKENS.find((token) => token.networkId === "SN_MAIN" && token.symbol === symbol)
    ?.address ?? "";
const ETH_TOKEN_ADDRESS = mainnetToken("ETH");
const STRK_TOKEN_ADDRESS = mainnetToken("STRK");

import { createMemoryStore } from "../../src/storage/kv";
import type { AccountRef, Vault } from "../../src/storage/vault-schema";

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
const sellTokenId = `SN_MAIN:ETH:${ETH_TOKEN_ADDRESS}`;
const buyTokenId = `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`;
const QUOTE_ID = "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca";

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

// 12.5 STRK in base units (12.5e18) as the aggregator would return it.
const BUY_AMOUNT_HEX = `0x${(125n * 10n ** 17n).toString(16)}`;

const defaultBuild: readonly SwapCall[] = [
  {
    calldata: ["0x1", "0x2386f26fc10000", "0x0"],
    contractAddress: ETH_TOKEN_ADDRESS,
    entrypoint: "approve",
  },
  {
    calldata: ["0x3"],
    contractAddress: "0x2c56e8b00dbe2a71e57472685378fc8988bba947e9a99b26a00fade2b4fe7c2",
    entrypoint: "multi_route_swap",
  },
];

const makeHarness = (options?: {
  readonly build?: readonly SwapCall[];
  readonly buildError?: string;
  readonly locked?: boolean;
  readonly quoteError?: string;
}) => {
  const session = createUnlockSession();
  if (!options?.locked) {
    session.unlock(vaultPassphrase);
  }
  let tick = 0;
  const activity = createActivityLog({
    now: () => {
      tick += 1000;
      return tick;
    },
    store: createMemoryStore(),
  });
  const quoteRequests: unknown[] = [];
  const buildRequests: unknown[] = [];
  const submitted: unknown[] = [];
  const swap: SwapService = {
    async listTokens() {
      return [
        { address: ETH_TOKEN_ADDRESS, decimals: 18, name: "Ether", symbol: "ETH" },
        { address: STRK_TOKEN_ADDRESS, decimals: 18, name: "Starknet Token", symbol: "STRK" },
      ];
    },
    async buildCalls(input) {
      buildRequests.push(input);
      if (options?.buildError) {
        throw new Error(options.buildError);
      }
      return {
        calls: options?.build ?? defaultBuild,
        chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
      };
    },
    async getQuote(input) {
      quoteRequests.push(input);
      if (options?.quoteError) {
        throw new Error(options.quoteError);
      }
      return {
        buyAmount: BUY_AMOUNT_HEX,
        buyAmountInUsd: 18.8,
        buyTokenAddress: STRK_TOKEN_ADDRESS,
        gasFeesInUsd: 0.025,
        quoteId: QUOTE_ID,
        sellAmount: input.sellAmount,
        sellAmountInUsd: 18.79,
        sellTokenAddress: ETH_TOKEN_ADDRESS,
      };
    },
  };
  const handler = createMessageHandler(walletStub, "extension-id", {
    activity,
    runtimeRpc: {
      async submitInvokeTransaction({ calls }: { readonly calls: readonly unknown[] }) {
        submitted.push(calls);
        return { calls: [], transactionHash: "0x5aa9" };
      },
    } as never,
    session,
    swap,
  });
  return { activity, buildRequests, handler, quoteRequests, submitted, swap };
};

const prepareSwap = (
  handler: ReturnType<typeof createMessageHandler>,
  overrides: Readonly<Record<string, unknown>> = {},
) =>
  handler(
    {
      amount: "0.01",
      buyAmount: "12.5",
      buyTokenId,
      quoteId: QUOTE_ID,
      sellTokenId,
      type: "wallet.swapPrepare",
      ...overrides,
    },
    extensionSender,
  );

describe("swap operations", () => {
  test("swapTokens returns the verified catalog for the active network", async () => {
    const { handler } = makeHarness();
    const response = await handler({ type: "wallet.swapTokens" }, extensionSender);
    expect(response).toMatchObject({
      ok: true,
      swapTokens: [
        { address: ETH_TOKEN_ADDRESS, symbol: "ETH" },
        { address: STRK_TOKEN_ADDRESS, symbol: "STRK" },
      ],
    });
  });

  test("quote returns a display-ready view for the tracked pair", async () => {
    const { handler, quoteRequests } = makeHarness();
    const response = await handler(
      { amount: "0.01", buyTokenId, sellTokenId, type: "wallet.swapQuote" },
      extensionSender,
    );
    expect(response).toMatchObject({
      ok: true,
      swapQuote: {
        buyAmount: "12.5",
        buyAmountInUsd: 18.8,
        gasFeesInUsd: 0.025,
        quoteId: QUOTE_ID,
        sellAmount: "0.01",
      },
    });
    expect(quoteRequests[0]).toMatchObject({
      buyTokenAddress: STRK_TOKEN_ADDRESS,
      networkId: "SN_MAIN",
      sellAmount: `0x${(10n ** 16n).toString(16)}`,
      sellTokenAddress: ETH_TOKEN_ADDRESS,
      takerAddress: account.address,
    });
  });

  test("quotes fail closed when locked, zero, same-pair, or aggregator errors", async () => {
    const locked = makeHarness({ locked: true });
    expect(
      await locked.handler(
        { amount: "0.01", buyTokenId, sellTokenId, type: "wallet.swapQuote" },
        extensionSender,
      ),
    ).toEqual({ error: "wallet locked" });

    const { handler } = makeHarness();
    expect(
      await handler(
        { amount: "0", buyTokenId, sellTokenId, type: "wallet.swapQuote" },
        extensionSender,
      ),
    ).toEqual({ error: "enter an amount to swap" });
    expect(
      await handler(
        { amount: "1", buyTokenId: sellTokenId, sellTokenId, type: "wallet.swapQuote" },
        extensionSender,
      ),
    ).toEqual({ error: "pick two different tokens" });

    const failing = makeHarness({ quoteError: "no swap route available for this pair" });
    expect(
      await failing.handler(
        { amount: "0.01", buyTokenId, sellTokenId, type: "wallet.swapQuote" },
        extensionSender,
      ),
    ).toEqual({ error: "no swap route available for this pair" });
  });

  test("prepares exact calls, then submits the one-time frozen route and records activity", async () => {
    const { activity, buildRequests, handler, submitted } = makeHarness();
    const prepared = await prepareSwap(handler);
    const preparationId = "swapPreparation" in prepared ? prepared.swapPreparation.id : "";
    expect(prepared).toMatchObject({ ok: true });
    expect(preparationId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(
      "swapPreparation" in prepared ? prepared.swapPreparation.summaries.join(" ") : "",
    ).toContain("multi_route_swap");
    const response = await handler({ preparationId, type: "wallet.swapExecute" }, extensionSender);
    expect(response).toEqual({ ok: true, transactionHash: "0x5aa9" });
    expect(buildRequests[0]).toMatchObject({
      networkId: "SN_MAIN",
      quoteId: QUOTE_ID,
      slippage: 0.005,
      takerAddress: account.address,
    });
    expect(submitted).toHaveLength(1);
    const entries = await activity.list();
    expect(entries[0]).toMatchObject({
      accountId: account.id,
      amount: "0.01",
      hash: "0x5aa9",
      kind: "invoke",
      summary: "Swap 0.01 ETH for ~12.5 STRK via AVNU",
      token: "ETH",
    });
    expect(await handler({ preparationId, type: "wallet.swapExecute" }, extensionSender)).toEqual({
      error: "swap preparation not found",
    });
    expect(submitted).toHaveLength(1);
  });

  test("an approve on any token other than the sell token is rejected unsigned", async () => {
    const rogue: readonly SwapCall[] = [
      {
        calldata: ["0x1", "0xffffffffffffffffffffffff", "0x0"],
        contractAddress: STRK_TOKEN_ADDRESS,
        entrypoint: "approve",
      },
    ];
    const { handler, submitted } = makeHarness({ build: rogue });
    const response = await prepareSwap(handler);
    expect(response).toEqual({ error: "swap build touched an unexpected token approval" });
    expect(submitted).toHaveLength(0);
  });

  test("an approval larger than the quoted sell amount is rejected unsigned", async () => {
    const inflated: readonly SwapCall[] = [
      {
        calldata: ["0x1", "0xffffffffffffffffffffffff", "0x0"],
        contractAddress: ETH_TOKEN_ADDRESS,
        entrypoint: "approve",
      },
      defaultBuild[1] as SwapCall,
    ];
    const { handler, submitted } = makeHarness({ build: inflated });

    await expect(prepareSwap(handler)).resolves.toEqual({
      error: "swap build requested an unexpected token allowance",
    });
    expect(submitted).toHaveLength(0);
  });

  test("build failures surface their message and never reach signing", async () => {
    const { handler, submitted } = makeHarness({ buildError: "swap build failed" });
    const response = await prepareSwap(handler);
    expect(response).toEqual({ error: "swap build failed" });
    expect(submitted).toHaveLength(0);
  });

  test("malformed inputs are rejected before any aggregator contact", async () => {
    const { handler, quoteRequests } = makeHarness();
    expect(
      await handler(
        { amount: "1e18", buyTokenId, sellTokenId, type: "wallet.swapQuote" },
        extensionSender,
      ),
    ).toEqual({ error: "invalid swap quote request" });
    expect(
      await handler(
        {
          amount: "0.01",
          buyAmount: "12.5",
          buyTokenId,
          quoteId: "../evil",
          sellTokenId,
          type: "wallet.swapPrepare",
        },
        extensionSender,
      ),
    ).toEqual({ error: "invalid swap preparation request" });
    expect(
      await handler(
        {
          amount: "0.01",
          buyAmount: "12.5",
          buyTokenId,
          quoteId: QUOTE_ID,
          sellTokenId,
          slippage: 0.5,
          type: "wallet.swapPrepare",
        },
        extensionSender,
      ),
    ).toEqual({ error: "invalid swap preparation request" });
    expect(quoteRequests).toHaveLength(0);
  });
});
