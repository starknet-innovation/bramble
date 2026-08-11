/**
 * Background swap-operation checks: quotes come back as display-ready views,
 * execution enforces the approve-only-sell-token policy before anything is
 * signed, results land in the activity feed, and every failure path (locked
 * wallet, bad input, aggregator errors) fails closed with an error response.
 */

import { describe, expect, test } from "bun:test";
import { createActivityLog } from "@mc-wallet/transactions/activity";
import { avnuRouterAddress, type SwapCall, type SwapService } from "@mc-wallet/transactions/avnu";
import { DEFAULT_TOKENS, STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { avnuRouteCalldata } from "../../support/avnu-route-fixture";

const mainnetToken = (symbol: string): string =>
  DEFAULT_TOKENS.find((token) => token.networkId === "SN_MAIN" && token.symbol === symbol)
    ?.address ?? "";
const ETH_TOKEN_ADDRESS = mainnetToken("ETH");
const STRK_TOKEN_ADDRESS = mainnetToken("STRK");

import { createMemoryStore } from "@mc-wallet/store/kv";
import type { Vault } from "@mc-wallet/vault/schema";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";

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

// The wallet's PINNED AVNU router for this network: the only contract the
// approval may name as spender and the only contract a swap call may run on
// (see the build-policy gate in background/transactions/swap-build-policy.ts). Read from
// the pin, never restated, so this fixture keeps describing a real build.
const ROUTER_ADDRESS = avnuRouterAddress("SN_MAIN");

// 0.01 ETH in wei and the reviewed 0.5% floor under the 12.5 STRK quote: the
// route the wallet accepts has to state both, so the fixture states both.
const SELL_AMOUNT = 10n ** 16n;
const MIN_BUY_AMOUNT = 124_375n * 10n ** 14n;

const defaultBuild: readonly SwapCall[] = [
  {
    calldata: [ROUTER_ADDRESS, "0x2386f26fc10000", "0x0"],
    contractAddress: ETH_TOKEN_ADDRESS,
    entrypoint: "approve",
  },
  {
    calldata: avnuRouteCalldata({
      beneficiary: account.address,
      buyAmount: 125n * 10n ** 17n,
      buyToken: STRK_TOKEN_ADDRESS,
      minBuyAmount: MIN_BUY_AMOUNT,
      sellAmount: SELL_AMOUNT,
      sellToken: ETH_TOKEN_ADDRESS,
    }),
    contractAddress: ROUTER_ADDRESS,
    entrypoint: "multi_route_swap",
  },
];

const makeHarness = (options?: {
  readonly build?: readonly SwapCall[];
  readonly buildError?: string;
  readonly activityWriteFails?: boolean;
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
    activity: options?.activityWriteFails
      ? { ...activity, record: () => Promise.reject(new Error("storage quota exceeded")) }
      : activity,
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

  // MCW-V09-108: the build's approval is a standing grant to the router until
  // the route spends it, and only the account that swapped can revoke it. Left
  // unrecorded, a residual router allowance would be invisible to the manager.
  test("files the router approval it submitted in the allowance log", async () => {
    const { handler } = makeHarness();
    const prepared = await prepareSwap(handler);
    const preparationId = "swapPreparation" in prepared ? prepared.swapPreparation.id : "";
    expect(await handler({ type: "wallet.allowances" }, extensionSender)).toEqual({
      allowances: [],
      ok: true,
    });

    await handler({ preparationId, type: "wallet.swapExecute" }, extensionSender);

    const listed = await handler({ type: "wallet.allowances" }, extensionSender);
    expect("allowances" in listed ? listed.allowances : []).toMatchObject([
      {
        accountId: account.id,
        // 0.01 ETH, exactly the quoted sell amount the policy admitted.
        amount: "10000000000000000",
        source: "wallet",
        spender: `0x${BigInt(ROUTER_ADDRESS).toString(16)}`,
        token: `0x${BigInt(ETH_TOKEN_ADDRESS).toString(16)}`,
      },
    ]);
  });

  // MCW-V09-108: bookkeeping must not sit behind another store's write. An
  // activity log that rejects (quota, IO) once left the router approval
  // unrecorded — an on-chain grant the manager could never list or revoke.
  test("files the approval even when the activity write fails after broadcast", async () => {
    const { handler, submitted } = makeHarness({ activityWriteFails: true });
    const prepared = await prepareSwap(handler);
    const preparationId = "swapPreparation" in prepared ? prepared.swapPreparation.id : "";

    await handler({ preparationId, type: "wallet.swapExecute" }, extensionSender);
    expect(submitted).toHaveLength(1);

    const listed = await handler({ type: "wallet.allowances" }, extensionSender);
    expect("allowances" in listed ? listed.allowances : []).toMatchObject([
      { amount: "10000000000000000", source: "wallet" },
    ]);
  });

  test("prepares exact calls, then submits the one-time frozen route and records activity", async () => {
    const { activity, buildRequests, handler, submitted } = makeHarness();
    const prepared = await prepareSwap(handler);
    const preparationId = "swapPreparation" in prepared ? prepared.swapPreparation.id : "";
    expect(prepared).toMatchObject({ ok: true });
    expect(preparationId).toMatch(/^sha256:[0-9a-f]{64}$/);
    // The route line is WALLET-AUTHORED from the decoded calldata, not the
    // verifier's generic "Call multi_route_swap on 0x…" — that generic form
    // read identically for a build that had moved the beneficiary.
    expect(
      "swapPreparation" in prepared ? prepared.swapPreparation.summaries.join(" ") : "",
    ).toContain("Swap 0.01 ETH for at least 12.4375 STRK, paid to 0x1234…bcde");
    expect("swapPreparation" in prepared ? prepared.swapPreparation.minBuyAmount : "").toBe(
      "12.4375",
    );
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

  test("the approve-only-sell-token policy covers both increase_allowance spellings", async () => {
    // Which selectors grant spend is defined once, by isApproveEntrypoint in
    // @mc-wallet/transactions/verify-selectors. If this gate kept its own list, a build
    // could route an approval onto another token under a spelling only the
    // reviewer knows about, and the policy would wave it through.
    for (const entrypoint of ["increase_allowance", "increaseAllowance"]) {
      const rogue: readonly SwapCall[] = [
        {
          calldata: ["0x1", "0xffffffffffffffffffffffff", "0x0"],
          contractAddress: STRK_TOKEN_ADDRESS,
          entrypoint,
        },
      ];
      const { handler, submitted } = makeHarness({ build: rogue });

      await expect(prepareSwap(handler)).resolves.toEqual({
        error: "swap build touched an unexpected token approval",
      });
      expect(submitted).toHaveLength(0);
    }
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
