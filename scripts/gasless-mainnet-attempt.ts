/**
 * One curated token for the opt-in mainnet script. Every skip prints its
 * reason. A gateway `invalid_gasless_request` also prints the build params
 * and the response body. The private key is never printed.
 */
import { Account, type Call, ec, type RpcProvider, stark } from "starknet";
import { createStrk20FeeReference } from "../apps/extension/src/background/privacy/strk20-fee-reference";
import { createPriceService } from "../packages/features/portfolio/src/tokens/prices";
import { accountSignsGaslessV2 } from "../packages/features/transactions/src/gasless/gasless-account";
import { gaslessFeeCeiling } from "../packages/features/transactions/src/gasless/gasless-ceiling";
import type { GaslessRoute } from "../packages/features/transactions/src/gasless/gasless-config";
import { GaslessRefusal } from "../packages/features/transactions/src/gasless/gasless-errors";
import {
  type GaslessFeeOffer,
  type GaslessListedToken,
  gaslessBuildParams,
  isGaslessFeeOffer,
  readGaslessQuote,
} from "../packages/features/transactions/src/gasless/gasless-request";
import { postGasless } from "../packages/features/transactions/src/gasless/gasless-rpc";
import { submitReviewedGaslessInvoke } from "../packages/features/transactions/src/gasless/gasless-submit";
import { validateGaslessTypedData } from "../packages/features/transactions/src/gasless/gasless-typed-data";
import type { PaymasterHttp } from "../packages/features/transactions/src/routing/paymaster-http";
import { untrustedFetch } from "../packages/foundation/core/src/http-json";
import {
  canonicalFelt,
  STRK_TOKEN_ADDRESS,
  sameFelt,
  uint256Felts,
} from "../packages/foundation/wallet-model/src/networks/networks";
import type { TokenConfig } from "../packages/foundation/wallet-model/src/preferences/preferences";
import { IndeterminateRpcWriteError } from "../packages/platform/starknet/src/rpc/provider";
import { buildErc20TransferCall } from "../packages/platform/starknet/src/rpc/rpc";
import { createMemoryStore } from "../packages/platform/store/src/kv";
import type { LoadedMainnetAccount } from "./gasless-mainnet-account";
import { receiptReverted, receiptSucceeded, transferredAmount } from "./gasless-mainnet-receipt";

const RECEIPT_TIMEOUT_MS = 180_000;
const RECEIPT_POLL_MS = 4_000;

type ReadyRoute = GaslessRoute & { readonly enabled: true; readonly forwarder: string };
type Family = "argent" | "openzeppelin";

/** Last paymaster exchange, so a refusal can print the body `postGasless` drops. */
type GaslessTransport = {
  readonly executed: () => number;
  readonly http: PaymasterHttp;
  readonly lastExchange: () => {
    readonly request: string;
    readonly status: number;
    readonly text: string;
  };
};

type TokenAttempt = {
  readonly account: LoadedMainnetAccount;
  readonly classHash: string;
  readonly family: Family;
  readonly listed: readonly GaslessListedToken[];
  readonly provider: RpcProvider;
  readonly route: ReadyRoute;
  readonly token: TokenConfig;
  readonly transport: GaslessTransport;
};

const href = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const redact = (text: string, key: string): string => text.split(key).join("[redacted]");

const skipped = (symbol: string, reason: string): null => {
  console.log(`${symbol}: ${reason}`);
  return null;
};

/**
 * Paymaster transport that counts execute calls and keeps the last response
 * text. The key is not read here.
 */
export const recordingHttp = (): GaslessTransport => {
  let execute = 0;
  let last = { request: "", status: 0, text: "" };
  const http: PaymasterHttp = async (input, init = {}) => {
    const body = typeof init.body === "string" ? init.body : "";
    if (body.includes('"paymaster_executeTransaction"')) execute += 1;
    const response = await untrustedFetch(href(input), init);
    last = { request: body, status: response.status, text: await response.clone().text() };
    return response;
  };
  return { executed: () => execute, http, lastExchange: () => last };
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

const strkReference = async (input: TokenAttempt, call: Call): Promise<bigint | null> => {
  const symbol = input.token.symbol;
  const starkAccount = new Account({
    address: input.account.address,
    provider: input.provider,
    signer: input.account.privateKey,
  });
  const details = {
    skipValidate: true,
    tip: "0x0",
  } as Parameters<Account["estimateInvokeFee"]>[1];
  let fri: bigint;
  try {
    const estimated = await starkAccount.estimateInvokeFee([call], details);
    fri = BigInt(estimated.overall_fee);
  } catch (error) {
    const message = error instanceof Error ? error.message : "estimate failed";
    return skipped(
      symbol,
      `STRK fee estimate failed: ${redact(message, input.account.privateKey)}`,
    );
  }
  if (fri <= 0n) return skipped(symbol, "STRK fee estimate was zero.");
  const prices = createPriceService({
    http: (url, init) => untrustedFetch(url, init),
    store: createMemoryStore(),
  });
  const priced = await createStrk20FeeReference(prices)({
    feeToken: input.token.address,
    networkId: "SN_MAIN",
    poolFeeFri: fri,
  });
  if (priced === null) return skipped(symbol, "price unavailable.");
  return priced;
};

const printExchange = (input: TokenAttempt): void => {
  const exchange = input.transport.lastExchange();
  const key = input.account.privateKey;
  console.log(`request ${redact(exchange.request.slice(0, 4000), key)}`);
  console.log(`response ${exchange.status} ${redact(exchange.text.slice(0, 4000), key)}`);
};

const builtQuote = async (
  input: TokenAttempt,
  call: Call,
  priced: bigint,
): Promise<{ readonly amount: bigint; readonly ceiling: bigint } | null> => {
  const symbol = input.token.symbol;
  const ceiling = gaslessFeeCeiling(priced);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const params = gaslessBuildParams({
    calls: [call],
    gasToken: input.token.address,
    nowSeconds,
    userAddress: input.account.address,
  });
  let result: unknown;
  try {
    result = await postGasless(
      input.transport.http,
      input.route.url,
      "paymaster_buildTransaction",
      params,
      {
        executes: false,
      },
    );
  } catch (error) {
    if (!(error instanceof GaslessRefusal)) throw error;
    console.log(`${symbol}: build ${error.code}. ${error.message}`);
    if (error.code === "invalid_gasless_request" || input.transport.lastExchange().status >= 400) {
      printExchange(input);
    }
    return null;
  }
  const quote = readGaslessQuote(result, "invoke");
  if (quote === null) {
    console.log(`${symbol}: build result was not a quote.`);
    printExchange(input);
    return null;
  }
  const validated = validateGaslessTypedData({
    accountAddress: input.account.address,
    calls: [call],
    ceiling,
    chainId: "SN_MAIN",
    forwarder: input.route.forwarder,
    gasToken: input.token.address,
    minimumRemainingSeconds: 10n,
    nowSeconds,
    quotedMax: quote.quotedMax,
    value: quote.typedData,
  });
  if (!validated.ok) {
    console.log(
      `${symbol}: quoted max ${quote.quotedMax} vs ceiling ${ceiling} (${validated.reason}).`,
    );
    return null;
  }
  if (validated.feeAmount > ceiling) {
    console.log(`${symbol}: quoted fee ${validated.feeAmount} is above the ceiling ${ceiling}.`);
    return null;
  }
  return { amount: validated.feeAmount, ceiling };
};

const heldEnough = (input: TokenAttempt, balance: bigint): boolean => {
  const symbol = input.token.symbol;
  if (balance === 0n) {
    skipped(symbol, "not held (balance 0).");
    return false;
  }
  if (balance <= 1n) {
    skipped(symbol, `balance ${balance}, not enough for a 1-unit transfer and a fee.`);
    return false;
  }
  const listed = input.listed.find((token) => sameFelt(token.address, input.token.address));
  if (listed === undefined) {
    skipped(symbol, "not in the paymaster list.");
    return false;
  }
  if (listed.decimals !== input.token.decimals) {
    skipped(
      symbol,
      `paymaster decimals ${listed.decimals}, wallet decimals ${input.token.decimals}.`,
    );
    return false;
  }
  return true;
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

const refuseWithoutSpending = async (
  input: TokenAttempt,
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
    http: input.transport.http,
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
  if (input.transport.executed() !== 0) {
    throw new Error("Refusal checks posted paymaster_executeTransaction.");
  }
  console.log("Forwarder mismatch and over-ceiling quote refused before execute.");
};

const broadcast = async (
  input: TokenAttempt,
  call: Call,
  offer: GaslessFeeOffer,
  priced: bigint,
): Promise<boolean> => {
  const symbol = input.token.symbol;
  const strk = await balanceOf(input.provider, STRK_TOKEN_ADDRESS, input.account.address);
  const token = await balanceOf(input.provider, input.token.address, input.account.address);
  let submitted: Awaited<ReturnType<typeof submitReviewedGaslessInvoke>>;
  try {
    submitted = await submitReviewedGaslessInvoke({
      account: {
        accountContractType: input.family,
        address: input.account.address,
        classHash: input.classHash,
        deployed: true,
      },
      calls: [call],
      deployment: null,
      http: input.transport.http,
      isAuthorized: () => true,
      nowSeconds: Math.floor(Date.now() / 1000),
      readNowSeconds: () => Math.floor(Date.now() / 1000),
      referenceFor: () => Promise.resolve(priced),
      reviewed: offer,
      route: input.route,
      signHash: signerFor(input.account),
    });
  } catch (error) {
    if (error instanceof IndeterminateRpcWriteError) throw error;
    const message = error instanceof Error ? error.message : "submit failed";
    console.log(`${symbol}: submit failed. ${redact(message, input.account.privateKey)}`);
    if (input.transport.lastExchange().status >= 400) printExchange(input);
    return false;
  }
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

/**
 * Quotes and, when the quote is under the ceiling, submits one token.
 * Returns false only after printing why this token was not used. A broadcast
 * whose reply is lost throws, because another token must not be tried.
 */
export const payWithToken = async (input: TokenAttempt): Promise<boolean> => {
  if (
    !accountSignsGaslessV2({
      accountContractType: input.family,
      classHash: input.classHash,
      deployed: true,
    })
  ) {
    throw new Error(`Class ${input.classHash} cannot sign gasless v2.`);
  }
  const balance = await balanceOf(input.provider, input.token.address, input.account.address);
  if (!heldEnough(input, balance)) return false;
  const call = buildErc20TransferCall(input.token.address, input.account.address, 1n);
  const priced = await strkReference(input, call);
  if (priced === null) return false;
  const quote = await builtQuote(input, call, priced);
  if (quote === null) return false;
  const tokenAddress = canonicalFelt(input.token.address);
  const offer = {
    amount: quote.amount.toString(),
    decimals: input.token.decimals,
    label: input.token.symbol,
    tokenAddress: tokenAddress ?? input.token.address,
  };
  if (!isGaslessFeeOffer(offer)) {
    skipped(input.token.symbol, "quote was not a fee offer this wallet can show.");
    return false;
  }
  console.log(
    `${input.token.symbol}: balance ${balance}. Quote ${offer.amount}, ceiling ${quote.ceiling}.`,
  );
  console.log(`Forwarder ${input.route.forwarder}.`);
  await refuseWithoutSpending(input, call, offer, priced);
  return broadcast(input, call, offer, priced);
};
