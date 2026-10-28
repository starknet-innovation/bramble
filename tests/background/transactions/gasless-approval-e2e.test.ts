/**
 * Gasless dapp approval through the real invoke handlers. The Pay up to
 * button is the production card. Mainnet's shipped flag is on; the test hooks
 * still replace the transport and the clock. Sepolia stays off.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { INDETERMINATE_RPC_WRITE_MESSAGE } from "@bramble/starknet/provider";
import { GASLESS_FEES_ENABLED } from "@bramble/transactions/gasless-config";
import {
  registerDom,
  unregisterDom,
} from "../../../packages/presentation/wallet-ui/tests/support/groups-harness";
import {
  account,
  byMethod,
  contentSender,
  DAPP_ORIGIN,
  extensionSender,
  TX_HASH,
  USDC,
} from "./gasless-handler-constants";
import { closeGaslessHarness, dappCalls, openGaslessHarness } from "./gasless-handler-fixture";
import {
  approvalPayChoice,
  expectMainnetExecute,
  strkApproveFee,
  waitForGaslessApproval,
} from "./gasless-handler-ui";

beforeAll(() => registerDom());

afterAll(async () => {
  closeGaslessHarness();
  await unregisterDom();
});

beforeEach(() => {
  expect(GASLESS_FEES_ENABLED).toEqual({ SN_MAIN: true, SN_SEPOLIA: false });
});

afterEach(closeGaslessHarness);

const queueInvoke = (handler: ReturnType<typeof openGaslessHarness>["handler"]) =>
  handler(
    { calls: dappCalls(), origin: DAPP_ORIGIN, type: "wallet.addInvokeTransaction" },
    contentSender,
  );

describe("gasless dapp approval with the mainnet route enabled only in the test", () => {
  test("approves the Pay up to USDC button and records the invoke", async () => {
    const harness = openGaslessHarness();
    const held = queueInvoke(harness.handler);
    const pending = await waitForGaslessApproval(harness.handler);
    const offer = approvalPayChoice(pending);
    expect(offer).toEqual({ amount: "5000", decimals: 6, label: "USDC", tokenAddress: USDC });

    await expect(
      harness.handler(
        { gaslessFee: offer, id: pending.id, type: "wallet.approveOrigin" },
        extensionSender,
      ),
    ).resolves.toEqual({ ok: true, pending: [] });
    await expect(held).resolves.toEqual({ ok: true, transactionHash: TX_HASH });

    const builds = byMethod(harness.posts, "paymaster_buildTransaction");
    expect(builds.length).toBeGreaterThan(0);
    for (const build of builds) {
      expect(build.params).toMatchObject({
        parameters: { fee_mode: { gas_token: USDC, mode: "default" }, version: "0x1" },
        transaction: { type: "invoke" },
      });
    }
    const execute = byMethod(harness.posts, "paymaster_executeTransaction");
    expect(execute).toHaveLength(1);
    expectMainnetExecute(execute[0]?.params);
    expect(harness.relayAtExecute).toEqual([1]);
    expect(harness.submitted.invoke).toBe(0);
    const activity = await harness.activity.list();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      hash: TX_HASH,
      kind: "invoke",
      networkId: "SN_MAIN",
      userFee: { amount: "5000", token: "USDC", tokenAddress: USDC },
    });
    expect(activity[0]?.summary).toContain("(network fee 0.005 USDC)");
    expect(activity[0]?.summary).toContain(DAPP_ORIGIN);
    const relay = await harness.relay.list({ accountId: account.id, networkId: "SN_MAIN" });
    expect(relay[0]).toMatchObject({
      origin: DAPP_ORIGIN,
      revision: "2",
      status: "signed",
      userFee: { amount: "5000", decimals: 6, token: "USDC" },
    });
  });

  test("Approve without Pay up to submits the invoke in STRK", async () => {
    const harness = openGaslessHarness();
    const held = queueInvoke(harness.handler);
    const pending = await waitForGaslessApproval(harness.handler);
    const reviewedFee = strkApproveFee(pending);
    const quoted = harness.posts.length;
    await expect(
      harness.handler(
        { id: pending.id, reviewedFee, type: "wallet.approveOrigin" },
        extensionSender,
      ),
    ).resolves.toEqual({ ok: true, pending: [] });
    await expect(held).resolves.toEqual({ ok: true, transactionHash: "0x7ce" });
    expect(harness.posts).toHaveLength(quoted);
    expect(harness.submitted.invoke).toBe(1);
    const activity = await harness.activity.list();
    expect(activity[0]).toMatchObject({ hash: "0x7ce", kind: "invoke" });
    expect(activity[0]?.userFee).toBeUndefined();
  });

  test("screening_denied does not submit the invoke in STRK", async () => {
    const harness = openGaslessHarness();
    const held = queueInvoke(harness.handler);
    const pending = await waitForGaslessApproval(harness.handler);
    const offer = approvalPayChoice(pending);
    harness.script.execute = { code: "screening_denied", status: 400 };
    await expect(
      harness.handler(
        { gaslessFee: offer, id: pending.id, type: "wallet.approveOrigin" },
        extensionSender,
      ),
    ).resolves.toEqual({
      error: "This account can't pay the network fee in another token.",
    });
    await expect(held).resolves.toEqual({
      error: "This account can't pay the network fee in another token.",
    });
    expect(harness.submitted.invoke).toBe(0);
    expect(harness.relayAtExecute).toEqual([1]);
    expect(await harness.activity.list()).toEqual([]);
  });

  test("upstream_rejected on execute reports an unknown submission", async () => {
    const harness = openGaslessHarness();
    const held = queueInvoke(harness.handler);
    const pending = await waitForGaslessApproval(harness.handler);
    const offer = approvalPayChoice(pending);
    harness.script.execute = { code: "upstream_rejected", status: 400 };
    const response = {
      error: INDETERMINATE_RPC_WRITE_MESSAGE,
      submissionUnknown: true,
    };
    await expect(
      harness.handler(
        { gaslessFee: offer, id: pending.id, type: "wallet.approveOrigin" },
        extensionSender,
      ),
    ).resolves.toEqual(response);
    await expect(held).resolves.toEqual(response);
    expect(harness.submitted.invoke).toBe(0);
    expect(await harness.activity.list()).toEqual([]);
  });
});
