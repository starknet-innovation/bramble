/**
 * Handler harness for gasless fees. Mainnet's shipped flag is on. The
 * transport, class read, and clock installed here keep a case off the network.
 * Sepolia stays off.
 */
import type { PriceService } from "@bramble/portfolio/prices";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { buildErc20TransferCall } from "@bramble/starknet/rpc";
import { type ActivityLog, memoryActivityLog } from "@bramble/transactions/activity";
import {
  GASLESS_PAYMASTER_URLS,
  type GaslessRoute,
  gaslessRoute,
} from "@bramble/transactions/gasless-config";
import type { GaslessFeeOffer } from "@bramble/transactions/gasless-request";
import {
  memoryRelaySignatureLog,
  type RelaySignatureLog,
} from "@bramble/transactions/relay-signatures";
import type { Vault } from "@bramble/vault/schema";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";
import {
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { clearGaslessSendReview } from "../../../apps/extension/src/background/transactions/gasless-held-send";
import { setGaslessReviewHooksForTests } from "../../../apps/extension/src/background/transactions/gasless-review";
import { testExtension } from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import {
  AMOUNT,
  account,
  DAPP_ORIGIN,
  eth,
  FORWARDER,
  type GatewayScript,
  NOW,
  type Posted,
  RECIPIENT,
  STRK_FEE,
} from "./gasless-handler-constants";
import { createPaymasterHttp } from "./gasless-handler-gateway";

const PASSPHRASE = "correct horse battery staple";

type Handler = (message: unknown, sender?: RuntimeSender) => Promise<unknown>;

/** One open gasless handler, its logs, and the gateway script. */
export type GaslessHarness = {
  readonly activity: ActivityLog;
  readonly handler: Handler;
  readonly posts: Posted[];
  readonly relay: RelaySignatureLog;
  readonly relayAtExecute: number[];
  readonly script: GatewayScript;
  readonly signed: string[];
  readonly state: { deployed: boolean };
  readonly submitted: { erc20: number; invoke: number };
};

const vault = {
  accounts: [account],
  activeAccountId: account.id,
  originGrants: [{ accountIds: [account.id], origin: DAPP_ORIGIN }],
} as unknown as Vault;

/** Prices both legs at one dollar so the reference is the STRK estimate scaled by decimals. */
export const unitPrices = (): PriceService => ({
  async getPrices(input) {
    const prices: Record<string, number> = {};
    for (const address of input.addresses) {
      prices[address] = 1;
    }
    return { asOf: 1, changes: {}, currency: input.currency, prices, stale: false };
  },
  async getTokenChart() {
    return { currency: "usd", points: [] };
  },
});

const mainnetRoute = (networkId: StarknetNetworkId): GaslessRoute | null =>
  networkId === "SN_MAIN"
    ? {
        chainId: "SN_MAIN",
        enabled: true,
        forwarder: FORWARDER,
        url: GASLESS_PAYMASTER_URLS.SN_MAIN,
      }
    : gaslessRoute(networkId);

let fetchRestore: typeof fetch | null = null;

/**
 * Drops the test route and restores fetch. Safe when no harness is open.
 */
export const closeGaslessHarness = (): void => {
  setGaslessReviewHooksForTests(null);
  clearGaslessSendReview();
  if (fetchRestore !== null) {
    globalThis.fetch = fetchRestore;
    fetchRestore = null;
  }
  if (typeof document !== "undefined") {
    document.body.replaceChildren();
  }
};

const wallet = (signed: string[]) => ({
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts(origin: string) {
    return origin === DAPP_ORIGIN ? [account] : [];
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
    signed.push(input.messageHash);
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
});

/**
 * A real message handler whose gasless route is mainnet-only and enabled.
 * The shipped flags are not changed. `state.deployed` is the class read.
 */
export const openGaslessHarness = (): GaslessHarness => {
  closeGaslessHarness();
  fetchRestore = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network"))) as unknown as typeof fetch;
  const posts: Posted[] = [];
  const relayAtExecute: number[] = [];
  const signed: string[] = [];
  const submitted = { erc20: 0, invoke: 0 };
  const state = { deployed: true };
  const script: GatewayScript = {
    available: true,
    execute: "ok",
    firstBuild: "invoke",
    laterBuild: "invoke",
  };
  const relay = memoryRelaySignatureLog(() => 5_000);
  const activity = memoryActivityLog(() => 5_000);
  setGaslessReviewHooksForTests({
    http: createPaymasterHttp({ posts, relay, relayAtExecute, script }),
    makeProvider: () =>
      ({
        async getClassHashAt() {
          if (!state.deployed) {
            throw new Error("Contract not found");
          }
          return OPENZEPPELIN_ACCOUNT_CLASS_HASH;
        },
      }) as unknown as RpcProvider,
    nowSeconds: () => NOW,
    route: mainnetRoute,
  });
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  const handler = createMessageHandler(wallet(signed), testExtension, {
    activity,
    prices: unitPrices(),
    relaySignatures: relay,
    runtimeRpc: makeRuntimeRpc({
      async estimateInvokeFee() {
        return { overallFee: STRK_FEE, unit: "FRI" as const };
      },
      async getTokenBalances(input) {
        return input.tokens.map((token) => ({
          ...token,
          balance: sameFelt(token.address, STRK_TOKEN_ADDRESS) ? "0" : "1000000000",
          formatted: "0",
        }));
      },
      async submitErc20Transfer(input) {
        submitted.erc20 += 1;
        return {
          call: { calldata: [], contractAddress: input.token.address, entrypoint: "transfer" },
          transactionHash: "0x7cd",
        };
      },
      async submitInvokeTransaction(input) {
        submitted.invoke += 1;
        return { calls: input.calls, transactionHash: "0x7ce" };
      },
    }),
    session,
  });
  return { activity, handler, posts, relay, relayAtExecute, script, signed, state, submitted };
};

/** Pre-sign review for the ETH send. */
export const reviewMessage = {
  accountId: account.id,
  amount: AMOUNT,
  recipient: RECIPIENT,
  speed: "standard" as const,
  tokenId: eth.id,
  type: "wallet.reviewTransfer" as const,
};

/** Send message. A gasless fee is the Pay up to choice; a reviewed fee is STRK. */
export const transferMessage = (input: {
  readonly gaslessFee?: GaslessFeeOffer;
  readonly reviewedFee?: FeeEstimate;
}) => ({
  accountId: account.id,
  amount: AMOUNT,
  recipient: RECIPIENT,
  speed: "standard" as const,
  tokenId: eth.id,
  type: "wallet.transfer" as const,
  ...(input.gaslessFee ? { gaslessFee: input.gaslessFee } : {}),
  ...(input.reviewedFee ? { reviewedFee: input.reviewedFee } : {}),
});

/** One-base-unit ETH transfer a connected dapp can ask the account to sign. */
export const dappCalls = () => {
  const call = buildErc20TransferCall(eth.address, RECIPIENT, 1n);
  const raw = call.calldata;
  const calldata = Array.isArray(raw) ? raw.map((item) => String(item)) : [];
  return [
    {
      calldata,
      contractAddress: String(call.contractAddress),
      entrypoint: call.entrypoint,
    },
  ];
};
