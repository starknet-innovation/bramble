/**
 * A restored Braavos account is view-only. The private relay must refuse it
 * before the key is used, not after a signature has already been produced.
 */
import { expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { buildErc20ApproveCall } from "@bramble/starknet/rpc-assets";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { OutsideExecutionVersion, outsideExecution, type RpcProvider } from "starknet";
import {
  officialBuilder as builder,
  executeResult,
  STRK20_POOL_FEE_6_STRK as POOL_FEE_6_STRK,
  STRK20_POOL_ADDRESS as poolAddress,
  STRK20_RELAY_CONTEXT as relayContext,
  sdkRuntime as runtime,
  strk20ProviderFor,
} from "../support/official-sdk";

const depositApproval = buildErc20ApproveCall(STRK_TOKEN_ADDRESS, poolAddress, 0x64n);

test("refuses a private relay for a Braavos account before using the key", async () => {
  let signed = 0;
  let classReads = 0;
  const typedData = outsideExecution.getTypedData(
    "0x534e5f5345504f4c4941",
    { caller: "0x99", execute_after: "0x3e7", execute_before: "0x7d0" },
    "0x5",
    [depositApproval],
    OutsideExecutionVersion.V2,
  );
  const http = async (): Promise<Response> =>
    Response.json({
      id: "bramble-strk20",
      jsonrpc: "2.0",
      result: {
        fee: {
          estimated_fee_in_strk: "0x1",
          gas_token_price_in_strk: "0x1",
          suggested_max_fee_in_strk: "0x1",
        },
        fee_action: {
          amount: POOL_FEE_6_STRK,
          recipient: "0x99",
          token: STRK_TOKEN_ADDRESS,
          type: "withdraw",
        },
        parameters: {
          fee_mode: {
            mode: "sponsored_private",
            pool_fee_token: STRK_TOKEN_ADDRESS,
            tip: "normal",
          },
          time_bounds: null,
          version: "0x1",
        },
        type: "invoke_and_apply_action",
        typed_data: typedData,
      },
    });
  const base = strk20ProviderFor({ poolFee: POOL_FEE_6_STRK });
  const service = createOfficialStrk20Service({
    http,
    nowSeconds: () => 1_000,
    providerFor: () => {
      const provider = base();
      return {
        ...provider,
        getBlockLatestAccepted: async () => {
          classReads += 1;
          return { block_hash: "0x9", block_number: 1 };
        },
        getClassHashAt: async () => {
          classReads += 1;
          return "0xdef";
        },
      } as unknown as RpcProvider;
    },
    sdk: runtime(() => ({
      build: () => builder(executeResult()),
      discoverNotes: async () => ({ notes: new Map() }),
      executeWithInvocation: async () => executeResult(),
    })),
  });
  const actions = [{ amount: "0x64", token: STRK_TOKEN_ADDRESS, type: "deposit" as const }];
  const braavosContext = {
    ...relayContext,
    account: {
      ...relayContext.account,
      accountContractType: "braavos" as const,
      deploymentSalt: relayContext.account.publicKeyX,
    },
    signHash: async () => {
      signed += 1;
      return { publicKey: "0x1", r: "0x2", s: "0x3" };
    },
  };
  const plan = await service.quoteActions({ ...braavosContext, actions });
  await expect(service.submitActions({ ...braavosContext, actions, plan })).rejects.toThrow(
    "cannot yet authorize transactions",
  );
  expect(signed).toBe(0);
  expect(classReads).toBe(0);
});
