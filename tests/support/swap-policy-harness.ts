/**
 * The shared swap-policy harness: one AVNU build fixture set and one wired
 * `createMessageHandler` for every suite that judges what the aggregator
 * returned.
 *
 * The suites here drive the REAL handler rather than the policy function, so a
 * rejection proves the wallet refused the build end to end and submitted
 * nothing — not merely that a predicate returned a string. Fixtures live in one
 * place because the reviewed swap (0.01 ETH for 12.5 STRK at 0.5% slippage) is
 * the constant every hostile case is measured against; two copies of it would
 * eventually disagree about what "honest" means.
 */

import { createMemoryStore } from "@mc-wallet/store/kv";
import { createActivityLog } from "@mc-wallet/transactions/activity";
import { avnuRouterAddress, type SwapCall, type SwapService } from "@mc-wallet/transactions/avnu";
import type { Vault } from "@mc-wallet/vault/schema";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { DEFAULT_TOKENS, STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { type AvnuRouteFixture, avnuRouteCalldata } from "./avnu-route-fixture";

const mainnetToken = (symbol: string): string =>
  DEFAULT_TOKENS.find((token) => token.networkId === "SN_MAIN" && token.symbol === symbol)
    ?.address ?? "";
/** Mainnet ETH, from the seeded token defaults. */
export const ETH_TOKEN_ADDRESS = mainnetToken("ETH");
/** Mainnet STRK, from the seeded token defaults. */
export const STRK_TOKEN_ADDRESS = mainnetToken("STRK");

/** The unlocked account every swap suite prepares from. */
export const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

/** The privileged side-panel sender the swap messages require. */
export const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const vaultPassphrase = "correct horse battery staple";
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
/** Tracked-registry id of the sell token (mainnet ETH). */
export const sellTokenId = `SN_MAIN:ETH:${ETH_TOKEN_ADDRESS}`;
/** Tracked-registry id of the buy token (mainnet STRK). */
export const buyTokenId = `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`;
/** The quote id both suites build against. */
export const QUOTE_ID = "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca";

// 0.01 ETH in wei — the exact amount the quote below sells and the only
// allowance the policy admits.
const SELL_AMOUNT_HEX = `0x${(10n ** 16n).toString(16)}`;
const BUY_AMOUNT_HEX = `0x${(125n * 10n ** 17n).toString(16)}`;
// The pinned mainnet counterparty, read from the wallet-side pin rather than
// restated: a fixture that carried its own address would keep passing after a
// pin change while every real build started failing.
/** The wallet-side AVNU router pin, read rather than restated. */
export const ROUTER_ADDRESS = avnuRouterAddress("SN_MAIN");
/** Stands in for any address an aggregator might substitute. */
export const ATTACKER_ADDRESS = "0x6666666666666666666666666666666666666666666666666666666666666";
// Stands in for any contract the aggregator might name instead of the router —
// an NFT collection the victim holds, a lending pool they have a position in.
/** A contract the aggregator names instead of the pinned router. */
export const AGGREGATOR_CHOSEN_CONTRACT =
  "0x7777777777777777777777777777777777777777777777777777777777777";

/** The exact approval the reviewed 0.01 ETH swap admits. */
export const approveRouter: SwapCall = {
  calldata: [ROUTER_ADDRESS, SELL_AMOUNT_HEX, "0x0"],
  contractAddress: ETH_TOKEN_ADDRESS,
  entrypoint: "approve",
};

// 0.01 ETH and 12.5 STRK in base units, and the floor the reviewed 0.5%
// slippage implies over that quote.
/** 0.01 ETH in wei: the reviewed sell amount. */
export const SELL_AMOUNT = 10n ** 16n;
/** 12.5 STRK in base units: the quoted buy amount. */
export const BUY_AMOUNT = 125n * 10n ** 17n;
/** The minimum an honest 0.5%-slippage build carries under that quote. */
export const MIN_BUY_AMOUNT = 124_375n * 10n ** 14n;

// The honest build, and the one knob every hostile case below turns.
/**
 * The honest route call, plus the one knob a hostile case turns. Every field
 * is stated, so a rejection proves the field that changed is load-bearing.
 */
export const routeWith = (overrides: Partial<AvnuRouteFixture> = {}): SwapCall => ({
  calldata: avnuRouteCalldata({
    beneficiary: account.address,
    buyAmount: BUY_AMOUNT,
    buyToken: STRK_TOKEN_ADDRESS,
    minBuyAmount: MIN_BUY_AMOUNT,
    sellAmount: SELL_AMOUNT,
    sellToken: ETH_TOKEN_ADDRESS,
    ...overrides,
  }),
  contractAddress: ROUTER_ADDRESS,
  entrypoint: "multi_route_swap",
});
/** The honest route call. */
export const routeCall = routeWith();

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

/**
 * Drives the REAL background message handler over an injected AVNU service
 * that returns `build` verbatim, so every assertion runs through the same
 * validation, policy, freeze, and submit path production uses.
 */
export const makeSwapHarness = (build: readonly SwapCall[]) => {
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
  const submitted: unknown[] = [];
  const swap: SwapService = {
    async listTokens() {
      return [];
    },
    async buildCalls() {
      return { calls: build, chainId: STARKNET_NETWORKS.SN_MAIN.chainId };
    },
    async getQuote(input) {
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
      async estimateInvokeFee() {
        return { overallFee: "1", unit: "FRI" };
      },
      async submitInvokeTransaction({ calls }: { readonly calls: readonly unknown[] }) {
        submitted.push(calls);
        return { calls: [], transactionHash: "0x5aa9" };
      },
    } as never,
    session,
    swap,
  });
  return { handler, submitted };
};

/** Sends the reviewed wallet.swapPrepare for `build` and keeps what was submitted. */
export const prepareSwap = (build: readonly SwapCall[]) => {
  const { handler, submitted } = makeSwapHarness(build);
  return {
    response: handler(
      {
        amount: "0.01",
        buyAmount: "12.5",
        buyTokenId,
        quoteId: QUOTE_ID,
        sellTokenId,
        type: "wallet.swapPrepare",
      },
      extensionSender,
    ),
    submitted,
  };
};
