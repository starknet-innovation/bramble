/**
 * Opt-in Starknet mainnet gasless integration. Not part of `bun run check`.
 * Uses the wallet's quote, ceiling, typed-data check, and submit. Signs with
 * the configured account key. Prints the transaction hash and explorer links.
 * Skips with exit 0 when no account is configured.
 */

import { Account, type Call, ec, RpcProvider, stark } from "starknet";
import { createStrk20FeeReference } from "../apps/extension/src/background/privacy/strk20-fee-reference";
import { createPriceService } from "../packages/features/portfolio/src/tokens/prices";
import { knownTokensForNetwork } from "../packages/features/portfolio/src/tokens/token-registry";
import { accountSignsGaslessV2 } from "../packages/features/transactions/src/gasless/gasless-account";
import { gaslessFeeCeiling } from "../packages/features/transactions/src/gasless/gasless-ceiling";
import {
  GASLESS_FEES_ENABLED,
  type GaslessRoute,
  gaslessRoute,
} from "../packages/features/transactions/src/gasless/gasless-config";
import { GaslessRefusal } from "../packages/features/transactions/src/gasless/gasless-errors";
import type { GaslessFeeOffer } from "../packages/features/transactions/src/gasless/gasless-request";
import { postGasless } from "../packages/features/transactions/src/gasless/gasless-rpc";
import {
  quoteGaslessOffers,
  submitReviewedGaslessInvoke,
} from "../packages/features/transactions/src/gasless/gasless-submit";
import type { PaymasterHttp } from "../packages/features/transactions/src/routing/paymaster-http";
import { untrustedFetch } from "../packages/foundation/core/src/http-json";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  XVERSE_ARGENT_CLASS_HASH,
} from "../packages/foundation/wallet-model/src/accounts/account-families";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "../packages/foundation/wallet-model/src/accounts/accounts";
import {
  canonicalFelt,
  STRK_TOKEN_ADDRESS,
  sameFelt,
  uint256Felts,
} from "../packages/foundation/wallet-model/src/networks/networks";
import type { TokenConfig } from "../packages/foundation/wallet-model/src/preferences/preferences";
import { buildErc20TransferCall } from "../packages/platform/starknet/src/rpc/rpc";
import { createMemoryStore } from "../packages/platform/store/src/kv";
import { type LoadedMainnetAccount, loadProcessAccount } from "./gasless-mainnet-account";
import { receiptReverted, receiptSucceeded, transferredAmount } from "./gasless-mainnet-receipt";

const RECEIPT_TIMEOUT_MS = 180_000;
const RECEIPT_POLL_MS = 4_000;
const PIN = "0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f";

type ReadyRoute = GaslessRoute & { readonly enabled: true; readonly forwarder: string };
type Family = "argent" | "openzeppelin";
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const redact = (message: string, key: string): string => message.split(key).join("[redacted]");

const href = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const countingHttp = (): { readonly executed: () => number; readonly http: PaymasterHttp } => {
  let execute = 0;
  const http: PaymasterHttp = async (input, init = {}) => {
    const body = typeof init.body === "string" ? init.body : "";
    if (body.includes('"paymaster_executeTransaction"')) execute += 1;
    return untrustedFetch(href(input), init);
  };
  return { executed: () => execute, http };
};

const requireRoute = (): ReadyRoute => {
  const route = gaslessRoute("SN_MAIN");
  if (
    GASLESS_FEES_ENABLED.SN_SEPOLIA !== false ||
    route === null ||
    route.enabled !== true ||
    route.forwarder !== PIN
  ) {
    throw new Error("Mainnet gasless route is not the pinned, enabled route.");
  }
  return { ...route, enabled: true, forwarder: PIN };
};

const familyFor = (classHash: string): Family | null => {
  if (sameFelt(classHash, OPENZEPPELIN_ACCOUNT_CLASS_HASH)) return "openzeppelin";
  if (
    sameFelt(classHash, ARGENT_ACCOUNT_CLASS_HASH) ||
    sameFelt(classHash, XVERSE_ARGENT_CLASS_HASH)
  ) {
    return "argent";
  }
  return null;
};

const balanceOf = async (provider: RpcProvider, token: string, owner: string): Promise<bigint> => {
  const result = await provider.callContract({
    calldata: [owner],
    contractAddress: token,
    entrypoint: "balanceOf",
  });
  const amount = uint256Felts(result[0], result[1]);
  if (amount === null) throw new Error(`Balance of ${token} was not a uint256.`);
  return amount;
};

const signerFor = (account: LoadedMainnetAccount) => async (messageHash: string) => {
  const signature = ec.starkCurve.sign(messageHash, account.privateKey);
  const [r, s] = stark.formatSignature(signature);
  const derived = ec.starkCurve.getStarkKey(account.privateKey);
  const publicKey = canonicalFelt(account.publicKey ?? String(derived));
  if (publicKey === null || r === undefined || s === undefined) {
    throw new Error("Could not encode the account signature.");
  }
  return { publicKey, r, s };
};

const refusal = async (run: () => Promise<unknown>): Promise<GaslessRefusal> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof GaslessRefusal) return error;
    throw error;
  }
  throw new Error("Expected a gasless refusal.");
};

const assertNoExecute = (executed: number, label: string): void => {
  if (executed !== 0) throw new Error(`${label} posted paymaster_executeTransaction.`);
};

const waitForReceipt = async (provider: RpcProvider, txHash: string): Promise<unknown> => {
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  let last = "not seen yet";
  while (Date.now() < deadline) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receiptSucceeded(receipt)) return receipt;
      if (receiptReverted(receipt)) throw new Error(`Transaction ${txHash} reverted.`);
      last = "pending";
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Transaction ")) throw error;
      last = error instanceof Error ? error.message : "receipt unread";
    }
    await sleep(RECEIPT_POLL_MS);
  }
  throw new Error(`No successful receipt for ${txHash} after 3 minutes (${last}).`);
};

const confirmFee = async (input: {
  readonly account: string;
  readonly amount: string;
  readonly before: { readonly strk: bigint; readonly token: bigint };
  readonly forwarder: string;
  readonly provider: RpcProvider;
  readonly receipt: unknown;
  readonly token: string;
}): Promise<void> => {
  const paid = transferredAmount(input.receipt, input.token, input.account, input.forwarder);
  if (paid !== BigInt(input.amount)) {
    throw new Error(`Fee transfer was ${String(paid)}, expected ${input.amount}.`);
  }
  const strkAfter = await balanceOf(input.provider, STRK_TOKEN_ADDRESS, input.account);
  const tokenAfter = await balanceOf(input.provider, input.token, input.account);
  if (strkAfter !== input.before.strk) {
    throw new Error("STRK balance changed. The account was charged a STRK fee.");
  }
  if (input.before.token - tokenAfter !== BigInt(input.amount)) {
    throw new Error("Fee-token balance delta does not match the signed fee.");
  }
};

type Attempt = {
  readonly account: LoadedMainnetAccount;
  readonly classHash: string;
  readonly executed: () => number;
  readonly family: Family;
  readonly http: PaymasterHttp;
  readonly provider: RpcProvider;
  readonly route: ReadyRoute;
  readonly token: TokenConfig;
};

const quoteToken = async (input: Attempt, call: Call, balance: bigint, priced: bigint) => {
  const offers = await quoteGaslessOffers({
    account: {
      accountContractType: input.family,
      address: input.account.address,
      classHash: input.classHash,
      deployed: true,
    },
    calls: [call],
    deployment: null,
    http: input.http,
    nowSeconds: Math.floor(Date.now() / 1000),
    referenceFor: () => Promise.resolve(priced),
    route: input.route,
    strkShort: true,
    tokens: [
      {
        address: input.token.address,
        balance: balance.toString(),
        decimals: input.token.decimals,
        label: input.token.symbol,
      },
    ],
  });
  return offers[0] ?? null;
};

const refuseWithoutSpending = async (
  input: Attempt,
  call: Call,
  offer: GaslessFeeOffer,
  priced: bigint,
): Promise<void> => {
  const signHash = signerFor(input.account);
  const shared = {
    account: {
      accountContractType: input.family,
      address: input.account.address,
      classHash: input.classHash,
      deployed: true as const,
    },
    calls: [call],
    deployment: null,
    http: input.http,
    isAuthorized: () => true,
    nowSeconds: Math.floor(Date.now() / 1000),
    readNowSeconds: () => Math.floor(Date.now() / 1000),
    reviewed: offer,
    signHash,
  };
  const mismatched = await refusal(() =>
    submitReviewedGaslessInvoke({
      ...shared,
      referenceFor: () => Promise.resolve(priced),
      route: { ...input.route, forwarder: "0x1" },
    }),
  );
  if (mismatched.code !== "invalid_gasless_request") {
    throw new Error(`Forwarder mismatch returned ${mismatched.code}.`);
  }
  const overCeiling = await refusal(() =>
    submitReviewedGaslessInvoke({
      ...shared,
      referenceFor: () => Promise.resolve(1n),
      route: input.route,
    }),
  );
  if (overCeiling.code !== "above_ceiling") {
    throw new Error(`Ceiling check returned ${overCeiling.code}.`);
  }
  assertNoExecute(input.executed(), "Refusal checks");
  console.log("Forwarder mismatch and over-ceiling quote refused before execute.");
};

const settle = async (
  input: Attempt,
  call: Call,
  offer: GaslessFeeOffer,
  priced: bigint,
): Promise<boolean> => {
  const ceiling = gaslessFeeCeiling(priced);
  if (BigInt(offer.amount) > ceiling) {
    throw new Error(`${input.token.symbol} quote ${offer.amount} is above the ceiling ${ceiling}.`);
  }
  console.log(`Quote ${offer.amount} ${input.token.symbol} base units, ceiling ${ceiling}.`);
  console.log(`Forwarder ${input.route.forwarder}.`);
  await refuseWithoutSpending(input, call, offer, priced);
  const strk = await balanceOf(input.provider, STRK_TOKEN_ADDRESS, input.account.address);
  const token = await balanceOf(input.provider, input.token.address, input.account.address);
  const submitted = await submitReviewedGaslessInvoke({
    account: {
      accountContractType: input.family,
      address: input.account.address,
      classHash: input.classHash,
      deployed: true,
    },
    calls: [call],
    deployment: null,
    http: input.http,
    isAuthorized: () => true,
    nowSeconds: Math.floor(Date.now() / 1000),
    readNowSeconds: () => Math.floor(Date.now() / 1000),
    referenceFor: () => Promise.resolve(priced),
    reviewed: offer,
    route: input.route,
    signHash: signerFor(input.account),
  });
  const txHash = canonicalFelt(submitted.transactionHash);
  if (txHash === null) throw new Error("Execute returned no transaction hash.");
  console.log(`Transaction ${txHash}`);
  console.log(`Voyager https://voyager.online/tx/${txHash}`);
  console.log(`Starkscan https://starkscan.co/tx/${txHash}`);
  const receipt = await waitForReceipt(input.provider, txHash);
  await confirmFee({
    account: input.account.address,
    amount: submitted.userFee.amount,
    before: { strk, token },
    forwarder: input.route.forwarder,
    provider: input.provider,
    receipt,
    token: offer.tokenAddress,
  });
  console.log(`Success. Fee ${submitted.userFee.amount} ${submitted.userFee.token}. No STRK fee.`);
  return true;
};

const tryToken = async (input: Attempt): Promise<boolean> => {
  const balance = await balanceOf(input.provider, input.token.address, input.account.address);
  if (balance <= 1n) return false;
  const call = buildErc20TransferCall(input.token.address, input.account.address, 1n);
  const starkAccount = new Account({
    address: input.account.address,
    provider: input.provider,
    signer: input.account.privateKey,
  });
  const estimated = await starkAccount.estimateInvokeFee(call);
  const prices = createPriceService({
    http: (url, init) => untrustedFetch(url, init),
    store: createMemoryStore(),
  });
  const priced = await createStrk20FeeReference(prices)({
    feeToken: input.token.address,
    networkId: "SN_MAIN",
    poolFeeFri: estimated.overall_fee,
  });
  if (priced === null)
    throw new Error(`No current USD price for ${input.token.symbol}. Refusing to sign.`);
  const offer = await quoteToken(input, call, balance, priced);
  if (!offer) return false;
  return settle(input, call, offer, priced);
};

/**
 * Runs the live mainnet path for one configured account. Throws on failure.
 */
const runGaslessMainnet = async (account: LoadedMainnetAccount): Promise<void> => {
  const route = requireRoute();
  const transport = countingHttp();
  const http = transport.http;
  console.log(`Account ${account.label}`);
  console.log(`RPC ${new URL(account.rpcUrl).host}`);
  const provider = new RpcProvider({ nodeUrl: account.rpcUrl });
  const classHashRaw = await provider.getClassHashAt(account.address);
  const classHash = canonicalFelt(String(classHashRaw));
  const family = classHash === null ? null : familyFor(classHash);
  const signs =
    classHash !== null &&
    family !== null &&
    accountSignsGaslessV2({ accountContractType: family, classHash, deployed: true });
  if (!signs || classHash === null || family === null) {
    throw new Error(
      `Class ${String(classHashRaw)} cannot sign gasless v2. Deploy OpenZeppelin ${OPENZEPPELIN_ACCOUNT_CLASS_HASH}.`,
    );
  }
  const available = await postGasless(http, route.url, "paymaster_isAvailable", [], {
    executes: false,
  });
  if (available !== true) throw new Error("paymaster_isAvailable did not return true.");
  console.log("paymaster_isAvailable: true");
  const mapped = await refusal(() =>
    postGasless(http, route.url, "paymaster_buildTransaction", [{ not: "valid" }], {
      executes: false,
    }),
  );
  if (mapped.code !== "invalid_gasless_request") {
    throw new Error(`Expected invalid_gasless_request, got ${mapped.code}.`);
  }
  assertNoExecute(transport.executed(), "Error-code check");
  console.log("Quote error invalid_gasless_request mapped without execute.");
  const known = knownTokensForNetwork("SN_MAIN").filter(
    (token) => !sameFelt(token.address, STRK_TOKEN_ADDRESS),
  );
  const usdc = known.find((token) => token.symbol === "USDC");
  const ordered = usdc === undefined ? known : [usdc, ...known.filter((token) => token !== usdc)];
  let usdcTooLow = false;
  for (const token of ordered) {
    const paid = await tryToken({
      account,
      classHash,
      executed: transport.executed,
      family,
      http,
      provider,
      route,
      token,
    });
    if (!paid) {
      if (token.symbol === "USDC") usdcTooLow = true;
      continue;
    }
    if (token.symbol !== "USDC") {
      console.log(
        usdcTooLow
          ? "USDC balance was too low, so another curated token paid the fee."
          : "USDC was not offered.",
      );
    }
    return;
  }
  throw new Error("No curated token the account holds produced a gasless quote under the ceiling.");
};

const main = async (): Promise<number> => {
  const loaded = await loadProcessAccount();
  if (loaded.kind === "skip") {
    console.log(loaded.message);
    return 0;
  }
  if (loaded.kind === "error") {
    console.error(loaded.message);
    return 1;
  }
  try {
    await runGaslessMainnet(loaded.account);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "gasless mainnet test failed";
    console.error(redact(message, loaded.account.privateKey));
    return 1;
  }
};

if (import.meta.main) {
  process.exit(await main());
}
