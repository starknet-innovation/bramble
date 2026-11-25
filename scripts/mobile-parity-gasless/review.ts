/**
 * The review block. Each case runs twice through the extension's own code:
 *
 * - `check`: `validateGaslessTypedData` with the case's ceiling (`gaslessFeeCeiling` of the
 *   independent reference) and the ten-second floor, answering the accepted terms or a reason;
 * - `submit`: `submitReviewedGaslessInvoke` over a scripted paymaster (its build reply carries the
 *   case's typed data) with a fixed signer, recording every body posted, the hash the signer was
 *   asked to sign (starknet.js's), and the submission or the refusal (its code and sentence).
 *
 * Every case records its effective inputs, defaults filled in, so the core needs no defaults.
 */
import { gaslessFeeCeiling } from "@bramble/transactions/gasless-ceiling";
import { gaslessRoute } from "@bramble/transactions/gasless-config";
import {
  GASLESS_SIGN_WINDOW_SECONDS,
  submitReviewedGaslessInvoke,
} from "@bramble/transactions/gasless-submit";
import { validateGaslessTypedData } from "@bramble/transactions/gasless-typed-data";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { DEFAULTS, REVIEW_CASES, type ReviewCase } from "./review-cases";
import {
  ARGENT_ACCOUNT,
  buildResult,
  type Reply,
  rpcResult,
  SEPOLIA_TEST_FORWARDER,
  type Sent,
  scriptedHttp,
  thrown,
  USDC,
} from "./shared";

/** The fixed signature every case's signer returns: the core's host signs, not the core. */
const SIGNATURE = { publicKey: "0x3", r: "0x1", s: "0x2" };

/** A Sepolia route switched on with a made-up forwarder, to reach deploy-and-invoke. */
const SEPOLIA_TEST_ROUTE = {
  chainId: "SN_SEPOLIA" as const,
  enabled: true,
  forwarder: SEPOLIA_TEST_FORWARDER,
  url: "https://wallet.example/api/paymaster/sepolia",
};

/** The fee token the user reviewed, as the offer spells it (the short felt). */
const REVIEWED_TOKEN = canonicalFelt(USDC) ?? USDC;

const effective = (item: ReviewCase) => {
  const typedData = item.typedData === undefined ? DEFAULTS.typedData : item.typedData;
  const quotedMax = item.quotedMax ?? DEFAULTS.quotedMax;
  const nowSeconds = item.nowSeconds ?? DEFAULTS.nowSeconds;
  const replies: readonly Reply[] = [
    item.buildReply ??
      rpcResult(
        buildResult(typedData, item.deployment ? "deploy_and_invoke" : "invoke", quotedMax),
      ),
    item.executeReply ?? rpcResult({ transaction_hash: "0x7a1ce5" }),
  ];
  return {
    account: item.account ?? ARGENT_ACCOUNT,
    calls: item.calls ?? DEFAULTS.calls,
    chainId: item.chainId ?? "SN_MAIN",
    deployment: item.deployment ?? null,
    locked: item.locked === true,
    nowSeconds,
    quotedMax,
    readNowSeconds: item.readNowSeconds ?? nowSeconds,
    reference: item.reference === undefined ? DEFAULTS.reference : item.reference,
    replies,
    reviewed: {
      amount: item.reviewedAmount ?? DEFAULTS.reviewedAmount,
      decimals: 6,
      label: "USDC",
      tokenAddress: REVIEWED_TOKEN,
    },
    route:
      item.route === "sepolia-default"
        ? gaslessRoute("SN_SEPOLIA")
        : item.route === "sepolia-test"
          ? SEPOLIA_TEST_ROUTE
          : gaslessRoute("SN_MAIN"),
    typedData,
  };
};

type Effective = ReturnType<typeof effective>;

// The check needs a forwarder; a route without one (the shipped Sepolia route) is checked
// against the made-up test forwarder, and the line says so.
const checkForwarder = (input: Effective): string =>
  input.route?.forwarder ?? SEPOLIA_TEST_ROUTE.forwarder;

const check = (input: Effective): object => {
  const result = validateGaslessTypedData({
    accountAddress: input.account.address,
    calls: input.calls,
    ceiling: input.reference === null ? 0n : gaslessFeeCeiling(input.reference),
    chainId: input.chainId,
    forwarder: checkForwarder(input),
    gasToken: input.reviewed.tokenAddress,
    minimumRemainingSeconds: GASLESS_SIGN_WINDOW_SECONDS,
    nowSeconds: input.nowSeconds,
    quotedMax: BigInt(input.quotedMax),
    value: input.typedData,
  });
  if (!result.ok) return result;
  return {
    caller: result.caller,
    executeAfter: result.executeAfter,
    executeBefore: result.executeBefore,
    feeAmount: result.feeAmount.toString(),
    ok: true,
  };
};

const submit = async (input: Effective): Promise<object> => {
  const sent: Sent[] = [];
  const signed: string[] = [];
  let outcome: object;
  try {
    outcome = await submitReviewedGaslessInvoke({
      account: input.account,
      calls: input.calls,
      deployment: input.deployment,
      http: scriptedHttp(input.replies, sent),
      // A locked case locks once the signer has answered.
      isAuthorized: () => !input.locked || signed.length === 0,
      nowSeconds: input.nowSeconds,
      readNowSeconds: () => input.readNowSeconds,
      referenceFor: async () => input.reference,
      reviewed: input.reviewed,
      route: input.route,
      signHash: async (messageHash) => {
        signed.push(messageHash);
        return SIGNATURE;
      },
    });
  } catch (error) {
    outcome = { refused: thrown(error) };
  }
  return { outcome, sent, signed: signed[0] ?? null };
};

/** Every review case: its effective inputs, the check's answer, and the submission's. */
export const computeReviews = async (): Promise<readonly object[]> => {
  const cases: object[] = [];
  for (const item of REVIEW_CASES) {
    const input = effective(item);
    cases.push({
      ...input,
      check: check(input),
      checkForwarder: checkForwarder(input),
      ...(input.route?.forwarder
        ? {}
        : { checkForwarderNote: "the route has no forwarder; the check uses the test forwarder" }),
      ...(item.knownExtensionBug ? { knownExtensionBug: item.knownExtensionBug } : {}),
      name: item.name,
      reference: input.reference?.toString() ?? null,
      signature: SIGNATURE,
      submit: await submit(input),
    });
  }
  return cases;
};
