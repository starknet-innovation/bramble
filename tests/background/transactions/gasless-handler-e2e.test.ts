/**
 * Gasless send through the real transfer handlers. Mainnet's shipped flag is
 * on; the test hooks still replace the transport and the clock so fetch cannot
 * leave the process. Sepolia stays off. Mainnet never builds deploy_and_invoke:
 * an undeployed account is refused before that request exists.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { isRecord } from "@bramble/core/json";
import { knownTokensForNetwork } from "@bramble/portfolio/token-registry";
import { INDETERMINATE_RPC_WRITE_MESSAGE } from "@bramble/starknet/provider";
import {
  GASLESS_FEE_CEILING_DENOMINATOR,
  GASLESS_FEE_CEILING_NUMERATOR,
  gaslessFeeCeiling,
} from "@bramble/transactions/gasless-ceiling";
import { GASLESS_FEES_ENABLED, GASLESS_PAYMASTER_URLS } from "@bramble/transactions/gasless-config";
import { GASLESS_MAX_WINDOW_SECONDS } from "@bramble/transactions/gasless-typed-data";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { createStrk20FeeReference } from "../../../apps/extension/src/background/privacy/strk20-fee-reference";
import {
  registerDom,
  unregisterDom,
} from "../../../packages/presentation/wallet-ui/tests/support/groups-harness";
import {
  AMOUNT,
  account,
  byMethod,
  extensionSender,
  NOW,
  OVER_CEILING,
  RECIPIENT,
  REFERENCE,
  STRK_FEE,
  TX_HASH,
  USDC,
} from "./gasless-handler-constants";
import {
  closeGaslessHarness,
  type GaslessHarness,
  openGaslessHarness,
  reviewMessage,
  transferMessage,
  unitPrices,
} from "./gasless-handler-fixture";
import { expectMainnetExecute, sendPayChoice } from "./gasless-handler-ui";

const QUOTE_REFUSED = "This network fee quote was refused. Nothing was submitted.";

beforeAll(() => registerDom());

afterAll(async () => {
  closeGaslessHarness();
  await unregisterDom();
});

beforeEach(() => {
  expect(GASLESS_FEES_ENABLED).toEqual({ SN_MAIN: true, SN_SEPOLIA: false });
});

afterEach(closeGaslessHarness);

const chooseUsdc = async (harness: GaslessHarness) => {
  const response = await harness.handler(reviewMessage, extensionSender);
  if (!isRecord(response) || !isRecord(response["review"])) {
    throw new Error(JSON.stringify(response));
  }
  const review = response["review"];
  const offer = sendPayChoice(review as Parameters<typeof sendPayChoice>[0]);
  expect(offer).toEqual({ amount: "5000", decimals: 6, label: "USDC", tokenAddress: USDC });
  return { offer, review };
};

const expectInvokeBuild = (params: unknown): void => {
  expect(params).toMatchObject({
    parameters: {
      fee_mode: { gas_token: USDC, mode: "default" },
      time_bounds: { execute_after: 1, execute_before: NOW + Number(GASLESS_MAX_WINDOW_SECONDS) },
      version: "0x1",
    },
    transaction: { type: "invoke" },
  });
  expect(params).not.toHaveProperty("userAddress");
  const encoded = JSON.stringify(params);
  expect(encoded).not.toContain("sponsored");
  expect(encoded).not.toContain("deploy_and_invoke");
  expect(encoded).not.toContain('"tip"');
};

describe("gasless send with the mainnet route enabled only in the test", () => {
  test("pays the reviewed USDC maximum and records the signed fee", async () => {
    const reference = createStrk20FeeReference(unitPrices());
    expect(
      await reference({
        feeToken: USDC,
        networkId: "SN_MAIN",
        poolFeeFri: BigInt(STRK_FEE),
      }),
    ).toBe(REFERENCE);
    expect(GASLESS_FEE_CEILING_NUMERATOR).toBe(6n);
    expect(GASLESS_FEE_CEILING_DENOMINATOR).toBe(5n);
    expect(gaslessFeeCeiling(REFERENCE)).toBe(6000n);
    expect(OVER_CEILING).toBe(gaslessFeeCeiling(REFERENCE) + 1n);
    const known = knownTokensForNetwork("SN_MAIN").find((token) => token.symbol === "USDC");
    expect(canonicalFelt(known?.address ?? "")).toBe(USDC);
    expect(known?.address.length).toBeGreaterThan(USDC.length);

    const harness = openGaslessHarness();
    const { offer } = await chooseUsdc(harness);
    expect(offer.amount).toBe(REFERENCE.toString());
    expect(BigInt(offer.amount) <= gaslessFeeCeiling(REFERENCE)).toBe(true);
    const response = await harness.handler(transferMessage({ gaslessFee: offer }), extensionSender);

    expect(response).toEqual({ ok: true, transactionHash: TX_HASH });
    expect(harness.posts.map((post) => post.url)).toEqual([
      GASLESS_PAYMASTER_URLS.SN_MAIN,
      GASLESS_PAYMASTER_URLS.SN_MAIN,
      GASLESS_PAYMASTER_URLS.SN_MAIN,
      GASLESS_PAYMASTER_URLS.SN_MAIN,
      GASLESS_PAYMASTER_URLS.SN_MAIN,
    ]);
    expect(harness.posts.map((post) => post.method)).toEqual([
      "paymaster_isAvailable",
      "paymaster_getSupportedTokens",
      "paymaster_buildTransaction",
      "paymaster_buildTransaction",
      "paymaster_executeTransaction",
    ]);
    for (const build of byMethod(harness.posts, "paymaster_buildTransaction")) {
      expectInvokeBuild(build.params);
    }
    const execute = byMethod(harness.posts, "paymaster_executeTransaction");
    expect(execute).toHaveLength(1);
    expectMainnetExecute(execute[0]?.params);
    expect(harness.relayAtExecute).toEqual([1]);
    expect(harness.signed).toHaveLength(1);
    expect(harness.submitted).toEqual({ erc20: 0, invoke: 0 });
    const activity = await harness.activity.list();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      amount: AMOUNT,
      counterparty: RECIPIENT,
      hash: TX_HASH,
      kind: "transfer",
      networkId: "SN_MAIN",
      userFee: { amount: "5000", token: "USDC", tokenAddress: USDC },
    });
    expect(activity[0]?.summary).toContain("(network fee 0.005 USDC)");
    const relay = await harness.relay.list({ accountId: account.id, networkId: "SN_MAIN" });
    expect(relay).toEqual([
      expect.objectContaining({
        origin: "Bramble",
        revision: "2",
        status: "signed",
        userFee: { amount: "5000", decimals: 6, token: "USDC" },
      }),
    ]);
  });

  test("refuses a fresh quote above the 6/5 ceiling before execute", async () => {
    const harness = openGaslessHarness();
    const { offer } = await chooseUsdc(harness);
    harness.script.laterBuild = "over-ceiling";
    const response = await harness.handler(transferMessage({ gaslessFee: offer }), extensionSender);
    expect(response).toEqual({ error: QUOTE_REFUSED });
    expect(byMethod(harness.posts, "paymaster_executeTransaction")).toEqual([]);
    expect(harness.signed).toEqual([]);
    expect(harness.submitted.erc20).toBe(0);
    expect(await harness.activity.list()).toEqual([]);
    expect(await harness.relay.list({ accountId: account.id, networkId: "SN_MAIN" })).toEqual([]);
  });

  test("refuses a caller that is not the pinned forwarder before execute", async () => {
    const harness = openGaslessHarness();
    const { offer } = await chooseUsdc(harness);
    harness.script.laterBuild = "wrong-forwarder";
    const response = await harness.handler(transferMessage({ gaslessFee: offer }), extensionSender);
    expect(response).toEqual({ error: QUOTE_REFUSED });
    expect(byMethod(harness.posts, "paymaster_executeTransaction")).toEqual([]);
    expect(harness.submitted.erc20).toBe(0);
    expect(await harness.activity.list()).toEqual([]);
  });

  test("an undeployed mainnet account is not quoted and still sends in STRK", async () => {
    const harness = openGaslessHarness();
    harness.state.deployed = false;
    const response = await harness.handler(reviewMessage, extensionSender);
    if (!isRecord(response) || !isRecord(response["review"])) {
      throw new Error(JSON.stringify(response));
    }
    expect(response["review"]["gaslessFees"]).toBeUndefined();
    expect(harness.posts).toEqual([]);
    const fee = response["review"]["fee"];
    if (!isRecord(fee)) {
      throw new Error("STRK fee was not reviewed");
    }
    const sent = await harness.handler(
      transferMessage({ reviewedFee: { overallFee: String(fee["overallFee"]), unit: "FRI" } }),
      extensionSender,
    );
    expect(sent).toEqual({ ok: true, transactionHash: "0x7cd" });
    expect(harness.submitted.erc20).toBe(1);
    expect(harness.posts).toEqual([]);
  });

  test("a mainnet account that is no longer deployed is not submitted as deploy_and_invoke", async () => {
    const harness = openGaslessHarness();
    const { offer } = await chooseUsdc(harness);
    const quoted = harness.posts.length;
    harness.state.deployed = false;
    const response = await harness.handler(transferMessage({ gaslessFee: offer }), extensionSender);
    expect(response).toEqual({ error: "Deploying on Mainnet needs STRK." });
    expect(harness.posts).toHaveLength(quoted);
    expect(JSON.stringify(harness.posts)).not.toContain("deploy_and_invoke");
    expect(byMethod(harness.posts, "paymaster_executeTransaction")).toEqual([]);
    expect(harness.submitted.erc20).toBe(0);
    expect(await harness.activity.list()).toEqual([]);
  });

  test("a deploy_and_invoke quote for a deployed account is not offered", async () => {
    const harness = openGaslessHarness();
    harness.script.firstBuild = "deploy_and_invoke";
    const response = await harness.handler(reviewMessage, extensionSender);
    if (!isRecord(response) || !isRecord(response["review"])) {
      throw new Error(JSON.stringify(response));
    }
    expect(response["review"]["gaslessFees"]).toBeUndefined();
    expectInvokeBuild(byMethod(harness.posts, "paymaster_buildTransaction")[0]?.params);
    const fee = response["review"]["fee"];
    if (!isRecord(fee)) {
      throw new Error("STRK fee was not reviewed");
    }
    const sent = await harness.handler(
      transferMessage({ reviewedFee: { overallFee: String(fee["overallFee"]), unit: "FRI" } }),
      extensionSender,
    );
    expect(sent).toEqual({ ok: true, transactionHash: "0x7cd" });
    expect(byMethod(harness.posts, "paymaster_executeTransaction")).toEqual([]);
  });

  test("leaving Pay up to unclicked submits the STRK transfer", async () => {
    const harness = openGaslessHarness();
    const { review } = await chooseUsdc(harness);
    const fee = review["fee"];
    if (!isRecord(fee) || fee["unit"] !== "FRI") {
      throw new Error("STRK fee was not reviewed");
    }
    const before = harness.posts.length;
    const response = await harness.handler(
      transferMessage({
        reviewedFee: { overallFee: String(fee["overallFee"]), unit: "FRI" },
      }),
      extensionSender,
    );
    expect(response).toEqual({ ok: true, transactionHash: "0x7cd" });
    expect(harness.posts).toHaveLength(before);
    expect(harness.submitted.erc20).toBe(1);
    const activity = await harness.activity.list();
    expect(activity[0]).toMatchObject({ hash: "0x7cd", kind: "transfer" });
    expect(activity[0]?.userFee).toBeUndefined();
    expect(activity[0]?.summary).not.toContain("network fee");
  });

  const gatewayCases = [
    {
      code: "gasless_disabled",
      error: "Paying the network fee in another token is unavailable.",
      executes: 1,
      status: 400,
      unknown: false,
    },
    {
      code: "screening_denied",
      error: "This account can't pay the network fee in another token.",
      executes: 1,
      status: 400,
      unknown: false,
    },
    {
      code: "screening_unavailable",
      error: "The network fee could not be checked. Nothing was submitted.",
      executes: 3,
      status: 503,
      unknown: false,
    },
    {
      code: "upstream_rejected",
      error: INDETERMINATE_RPC_WRITE_MESSAGE,
      executes: 1,
      status: 400,
      unknown: true,
    },
  ] as const;

  for (const spec of gatewayCases) {
    test(`execute ${spec.code} does not fall back to STRK`, async () => {
      const harness = openGaslessHarness();
      const { offer } = await chooseUsdc(harness);
      harness.script.execute = { code: spec.code, status: spec.status };
      const response = await harness.handler(
        transferMessage({ gaslessFee: offer }),
        extensionSender,
      );
      expect(response).toEqual(
        spec.unknown ? { error: spec.error, submissionUnknown: true } : { error: spec.error },
      );
      expect(byMethod(harness.posts, "paymaster_executeTransaction")).toHaveLength(spec.executes);
      expect(harness.relayAtExecute.every((rows) => rows >= 1)).toBe(true);
      expect(harness.submitted.erc20).toBe(0);
      expect(await harness.activity.list()).toEqual([]);
    });
  }
});
