/**
 * Network-backed Starknet RPC operations driven through the `makeProvider`
 * injection seam (mirroring scanTransactionHistory): balance and metadata reads,
 * the uint256 parse error path, transaction-status classification, and the
 * estimate/submit paths that drive a real starknet.js Account against a fake
 * provider whose channel returns canned JSON-RPC results.
 */
import { describe, expect, test } from "bun:test";
import {
  estimateInvokeFee,
  getTokenBalances,
  getTokenMetadata,
  getTransactionStatuses,
  submitErc20Transfer,
  submitInvokeTransaction,
  TRANSACTION_STATUS_CONCURRENCY,
  type TransactionStatus,
  type TransactionStatusReport,
} from "@mc-wallet/starknet/rpc";
import type { DerivedAccountRef } from "@mc-wallet/wallet-model/accounts";
import type { TokenConfig } from "@mc-wallet/wallet-model/preferences";
import { type Call, logger, type RpcProvider } from "starknet";

// The V3 fee estimate runs a tip analysis that logs a warning when the fake
// block carries no transactions; the estimate still falls back to a zero tip, so
// silence the noise rather than fabricate a busy block.
logger.setLogLevel("FATAL");

const RPC_URLS = ["https://rpc.example"] as const;
const ACCOUNT_ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const account: DerivedAccountRef = {
  accountContractType: "openzeppelin",
  address: ACCOUNT_ADDRESS,
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${ACCOUNT_ADDRESS}`,
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const eth: TokenConfig = {
  address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  decimals: 18,
  id: "SN_MAIN:ETH:0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};

let latestSignedHash = "0x0";
const signHash = async (messageHash = "0x0") => {
  latestSignedHash = messageHash;
  return { kind: "stark" as const, publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
};

// A provider fake for the read paths that call provider.callContract /
// provider.getTransactionStatus directly.
type CallContractFake = (request: {
  readonly contractAddress: string;
  readonly entrypoint: string;
}) => Promise<readonly string[]>;

const readProvider = (
  callContract: CallContractFake,
  getTransactionStatus?: (hash: string) => Promise<Record<string, unknown>>,
): RpcProvider =>
  ({
    callContract,
    getTransactionStatus,
  }) as unknown as RpcProvider;

describe("getTokenBalances", () => {
  test("reads and formats a tracked ERC20 balance through the injected provider", async () => {
    const seen: string[] = [];
    const balances = await getTokenBalances(
      { accountAddress: ACCOUNT_ADDRESS, rpcUrls: RPC_URLS, tokens: [eth] },
      () =>
        readProvider(async (request) => {
          seen.push(request.entrypoint);
          expect(request.contractAddress).toBe(eth.address);
          // 1.5 ETH as a uint256 low/high pair.
          return ["0x14d1120d7b160000", "0x0"];
        }),
    );
    expect(seen).toEqual(["balanceOf"]);
    expect(balances).toHaveLength(1);
    expect(balances[0]?.balance).toBe("1500000000000000000");
    expect(balances[0]?.formatted).toBe("1.5");
    expect(balances[0]?.symbol).toBe("ETH");
  });

  test("rejects a zero account address before any RPC call", async () => {
    let touched = false;
    await expect(
      getTokenBalances({ accountAddress: "0x0", rpcUrls: RPC_URLS, tokens: [eth] }, () => {
        touched = true;
        return readProvider(async () => ["0x1", "0x0"]);
      }),
    ).rejects.toThrow("Invalid account address");
    expect(touched).toBe(false);
  });

  test("throws through parseUint256Response when the balance felts are malformed", async () => {
    // A non-field-element low word must be rejected as an invalid balance
    // response rather than silently coerced — and as a WalletError it does not
    // fail over to the next endpoint.
    await expect(
      getTokenBalances({ accountAddress: ACCOUNT_ADDRESS, rpcUrls: RPC_URLS, tokens: [eth] }, () =>
        readProvider(async () => ["not-a-felt", "0x0"]),
      ),
    ).rejects.toThrow("Invalid token balance response");
  });

  test("throws when the balance response is missing the high word", async () => {
    await expect(
      getTokenBalances({ accountAddress: ACCOUNT_ADDRESS, rpcUrls: RPC_URLS, tokens: [eth] }, () =>
        readProvider(async () => ["0x1"]),
      ),
    ).rejects.toThrow("Invalid token balance response");
  });
});

describe("getTokenMetadata", () => {
  const metadataProvider = (decimalsResponse: readonly string[]): RpcProvider =>
    readProvider(async (request) => {
      if (request.entrypoint === "name") {
        return ["0x55534420436f696e"]; // "USD Coin"
      }
      if (request.entrypoint === "symbol") {
        return ["0x55534443"]; // "USDC"
      }
      return decimalsResponse;
    });

  test("decodes name, symbol, and decimals through the injected provider", async () => {
    const metadata = await getTokenMetadata({ address: eth.address, rpcUrls: RPC_URLS }, () =>
      metadataProvider(["0x6"]),
    );
    expect(metadata).toEqual({ decimals: 6, name: "USD Coin", symbol: "USDC" });
  });

  test("rejects a zero token address before any RPC call", async () => {
    await expect(
      getTokenMetadata({ address: "0x0", rpcUrls: RPC_URLS }, () => metadataProvider(["0x6"])),
    ).rejects.toThrow("Invalid token address");
  });

  test("throws when decimals are not a field element", async () => {
    await expect(
      getTokenMetadata({ address: eth.address, rpcUrls: RPC_URLS }, () =>
        metadataProvider(["not-hex"]),
      ),
    ).rejects.toThrow("Invalid token decimals");
  });

  test("throws when decimals exceed the supported range", async () => {
    await expect(
      getTokenMetadata({ address: eth.address, rpcUrls: RPC_URLS }, () =>
        metadataProvider(["0x25"]),
      ),
    ).rejects.toThrow("Invalid token decimals");
  });
});

describe("getTransactionStatuses", () => {
  const statusProvider = (byHash: Record<string, Record<string, unknown>>): RpcProvider =>
    readProvider(
      async () => [],
      async (hash) => {
        const status = byHash[hash];
        if (!status) {
          throw new Error("unexpected hash");
        }
        return status;
      },
    );

  const found = (status: TransactionStatus, finalizedOnL1 = false): TransactionStatusReport => ({
    finalizedOnL1,
    found: true,
    status,
  });

  test("classifies reverted, rejected, accepted, and pending statuses", async () => {
    const statuses = await getTransactionStatuses(
      { hashes: ["0xrev", "0xrej", "0xacc", "0xpend"], rpcUrls: RPC_URLS },
      () =>
        statusProvider({
          "0xacc": { execution_status: "SUCCEEDED", finality_status: "ACCEPTED_ON_L2" },
          "0xpend": { execution_status: "SUCCEEDED", finality_status: "RECEIVED" },
          "0xrej": { execution_status: "SUCCEEDED", finality_status: "REJECTED" },
          "0xrev": { execution_status: "REVERTED", finality_status: "ACCEPTED_ON_L2" },
        }),
    );
    expect(statuses).toEqual({
      "0xacc": found("accepted"),
      "0xpend": found("pending"),
      "0xrej": found("rejected"),
      "0xrev": found("reverted"),
    });
  });

  // The headline invariant of the fast-confirmation work: PRE_CONFIRMED is its
  // own status, and the REVERTED execution guard still wins over it, so a
  // pre-confirmed transaction that already reverted can never read as a
  // provisional success the Send flow would advance on.
  test("maps PRE_CONFIRMED to preconfirmed and lets a revert win over it", async () => {
    const statuses = await getTransactionStatuses(
      { hashes: ["0xpre", "0xprerev"], rpcUrls: RPC_URLS },
      () =>
        statusProvider({
          "0xpre": { execution_status: "SUCCEEDED", finality_status: "PRE_CONFIRMED" },
          "0xprerev": { execution_status: "REVERTED", finality_status: "PRE_CONFIRMED" },
        }),
    );
    expect(statuses).toEqual({
      "0xpre": found("preconfirmed"),
      "0xprerev": found("reverted"),
    });
  });

  // CANDIDATE is a distinct Starknet status (selected by the proposer, not yet
  // executed) that warrants its own handling later; today it must keep falling
  // through to pending rather than being mistaken for a pre-confirmation.
  test("leaves CANDIDATE and RECEIVED as pending", async () => {
    const statuses = await getTransactionStatuses({ hashes: ["0xcand"], rpcUrls: RPC_URLS }, () =>
      statusProvider({ "0xcand": { finality_status: "CANDIDATE" } }),
    );
    expect(statuses).toEqual({ "0xcand": found("pending") });
  });

  // Pins the extracted classifyStatus lookup: ACCEPTED_ON_L1 also maps to the
  // same user-visible accepted status but flags L1 finality (the background
  // monitor's terminal condition), and a receipt missing both fields falls
  // through to pending.
  test("accepts L1 finality and treats a fieldless receipt as pending", async () => {
    const statuses = await getTransactionStatuses(
      { hashes: ["0xl1", "0xbare"], rpcUrls: RPC_URLS },
      () =>
        statusProvider({
          "0xbare": {},
          "0xl1": { execution_status: "SUCCEEDED", finality_status: "ACCEPTED_ON_L1" },
        }),
    );
    expect(statuses).toEqual({
      "0xbare": found("pending"),
      "0xl1": found("accepted", true),
    });
  });

  // A node that answers TXN_HASH_NOT_FOUND is reported as not-found rather than
  // collapsed into pending, so the reconciler can tally consecutive
  // disappearances instead of waiting forever on a transaction that is gone.
  test("reports a not-found hash distinctly from pending", async () => {
    const semantic = Object.assign(new Error("transaction hash not found"), {
      baseError: { code: 29 },
    });
    const statuses = await getTransactionStatuses(
      { hashes: ["0xmissing"], rpcUrls: RPC_URLS },
      () =>
        readProvider(
          async () => [],
          async () => {
            throw semantic;
          },
        ),
    );
    expect(statuses).toEqual({
      "0xmissing": { finalizedOnL1: false, found: false, status: "pending" },
    });
  });

  test("treats any other semantic failure as pending, not as a disappearance", async () => {
    const semantic = Object.assign(new Error("something else"), { baseError: { code: 40 } });
    const statuses = await getTransactionStatuses({ hashes: ["0xodd"], rpcUrls: RPC_URLS }, () =>
      readProvider(
        async () => [],
        async () => {
          throw semantic;
        },
      ),
    );
    expect(statuses).toEqual({ "0xodd": found("pending") });
  });

  test("propagates a transport failure so the caller can degrade", async () => {
    await expect(
      getTransactionStatuses({ hashes: ["0xany"], rpcUrls: RPC_URLS }, () =>
        readProvider(
          async () => [],
          async () => {
            throw new Error("fetch failed");
          },
        ),
      ),
    ).rejects.toThrow("fetch failed");
  });

  test("bounds transaction-status RPC concurrency without dropping results", async () => {
    const hashes = Array.from(
      { length: TRANSACTION_STATUS_CONCURRENCY * 2 + 3 },
      (_, index) => `0x${(index + 1).toString(16)}`,
    );
    let active = 0;
    let maximum = 0;
    const statuses = await getTransactionStatuses({ hashes, rpcUrls: RPC_URLS }, () =>
      readProvider(
        async () => [],
        async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await Promise.resolve();
          active -= 1;
          return { execution_status: "SUCCEEDED", finality_status: "ACCEPTED_ON_L2" };
        },
      ),
    );

    expect(maximum).toBe(TRANSACTION_STATUS_CONCURRENCY);
    expect(Object.keys(statuses)).toEqual(hashes);
  });
});

// A fee estimate response shaped for the RPC channel's estimate parser.
const FEE_ESTIMATE = {
  data_gas_consumed: "0x1",
  data_gas_price: "0x1",
  gas_consumed: "0x1",
  gas_price: "0x1",
  l1_data_gas_consumed: "0x1",
  l1_data_gas_price: "0x1",
  l1_gas_consumed: "0x1",
  l1_gas_price: "0x1",
  l2_gas_consumed: "0x1",
  l2_gas_price: "0x1",
  overall_fee: "0x3e8",
  unit: "FRI",
} as const;

// Canned JSON-RPC channel results the injected Account touches when it estimates
// fees and invokes a transaction. `getBlockWithTxs` returns a block with no
// transactions so the built-in tip analysis falls back to a zero tip without a
// network. `getClassHashAt` reports the account as already deployed so the
// submit path skips counterfactual deployment.
const channelResponses: Record<string, unknown> = {
  getBlockWithTxs: { block_number: 100, timestamp: 1_700_000_000, transactions: [] },
  getChainId: "0x534e5f4d41494e",
  getEstimateFee: [FEE_ESTIMATE],
  getNonceForAddress: "0x0",
  specVersion: "0.8.1",
};

const accountProvider = (): RpcProvider => {
  const channel = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") {
          return undefined;
        }
        const key = String(prop);
        return async () =>
          key === "invoke" ? { transaction_hash: latestSignedHash } : channelResponses[key];
      },
    },
  );
  return {
    channel,
    async getChainId() {
      return "0x534e5f4d41494e";
    },
    async getClassHashAt() {
      return "0xclass";
    },
    async waitForTransaction() {
      return { execution_status: "SUCCEEDED" };
    },
  } as unknown as RpcProvider;
};

const oneCall: Call[] = [{ calldata: [], contractAddress: eth.address, entrypoint: "transfer" }];

describe("estimateInvokeFee", () => {
  test("returns a fee estimate without exercising the signer", async () => {
    let signCalls = 0;
    const estimate = await estimateInvokeFee(
      {
        account,
        calls: [...oneCall],
        rpcUrls: RPC_URLS,
        signHash: async () => {
          signCalls += 1;
          return signHash();
        },
      },
      accountProvider,
    );
    expect(typeof estimate.overallFee).toBe("string");
    expect(BigInt(estimate.overallFee) > 0n).toBe(true);
    expect(estimate.unit).toBe("FRI");
    expect(signCalls).toBe(0);
  });

  test("rejects an empty call list before touching the network", async () => {
    let touched = false;
    await expect(
      estimateInvokeFee({ account, calls: [], rpcUrls: RPC_URLS, signHash }, () => {
        touched = true;
        return accountProvider();
      }),
    ).rejects.toThrow("No calls to estimate");
    expect(touched).toBe(false);
  });
});

describe("submitInvokeTransaction", () => {
  test("signs and submits a standard-speed invoke", async () => {
    const result = await submitInvokeTransaction(
      {
        account,
        calls: [...oneCall],
        reviewedFee: { overallFee: "9999999", unit: "FRI" },
        rpcUrls: RPC_URLS,
        signHash,
      },
      accountProvider,
    );
    expect(latestSignedHash).toBe(result.transactionHash);
    expect(result.calls).toEqual(oneCall);
  });

  test("scales resource bounds on the fast path", async () => {
    // The fast path estimates first and feeds the bounds through scaledBounds,
    // then executes; the same canned channel serves both round trips.
    const result = await submitInvokeTransaction(
      {
        account,
        calls: [...oneCall],
        reviewedFee: { overallFee: "9999999", unit: "FRI" },
        rpcUrls: RPC_URLS,
        signHash,
        speed: "fast",
      },
      accountProvider,
    );
    expect(latestSignedHash).toBe(result.transactionHash);
  });

  test("rejects an empty call list before touching the network", async () => {
    await expect(
      submitInvokeTransaction({ account, calls: [], rpcUrls: RPC_URLS, signHash }, accountProvider),
    ).rejects.toThrow("No calls to submit");
  });
});

describe("submitErc20Transfer", () => {
  test("builds the transfer call and submits it through the injected provider", async () => {
    const submission = await submitErc20Transfer(
      {
        account,
        amount: "1.5",
        recipient: "0x0777000000000000000000000000000000000000000000000000000000000abc",
        reviewedFee: { overallFee: "9999999", unit: "FRI" },
        rpcUrls: RPC_URLS,
        signHash,
        token: eth,
      },
      accountProvider,
    );
    expect(latestSignedHash).toBe(submission.transactionHash);
    expect(submission.call.entrypoint).toBe("transfer");
    expect(submission.call.contractAddress).toBe(eth.address);
  });

  test("rejects a non-numeric transfer amount before submitting", async () => {
    // A garbage amount string fails parseTokenAmount's format guard, so the
    // transfer never reaches the provider.
    let touched = false;
    await expect(
      submitErc20Transfer(
        {
          account,
          amount: "not-a-number",
          recipient: "0x0777000000000000000000000000000000000000000000000000000000000abc",
          rpcUrls: RPC_URLS,
          signHash,
          token: eth,
        },
        () => {
          touched = true;
          return accountProvider();
        },
      ),
    ).rejects.toThrow("Invalid transfer amount");
    expect(touched).toBe(false);
  });
});
