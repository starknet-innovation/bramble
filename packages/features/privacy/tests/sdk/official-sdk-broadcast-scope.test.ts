/**
 * What an account-mode broadcast failure does to the maturity scope. The
 * distinction is load-bearing: a write that may already be on-chain must keep
 * the scope closed, while a failure that never reached the network must release
 * it or the persisted `submitting` guard wedges every later privacy operation.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { memoryStrk20MaturityStore } from "@bramble/privacy/maturity";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { submitInvokeTransaction } from "@bramble/starknet/rpc-submit";
import type { RpcProvider } from "starknet";
import {
  STRK20_SDK_ACCOUNT as account,
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  STRK20_POOL_ADDRESS as poolAddress,
  providerFor,
  STRK20_REVIEWED_FEE as reviewedFee,
  sdkRuntime as runtime,
  STRK20_SDK_TOKEN as token,
} from "../support/official-sdk";

const scope = {
  accountId: account.id,
  networkId: account.networkId,
  poolAddress,
};

const signedWrite = { nonce: "0x5", senderAddress: "0xdef", transactionHash: "0x456" };

const depositRequest = {
  ...context,
  actions: [{ amount: "0x1", token, type: "deposit" }],
  plan: { mode: "account", poolFeeFri: "0x0", reviewedFee },
} as const;

const depositSdk = () =>
  runtime(() => ({
    build: () => builder(),
    async discoverNotes() {
      return { notes: new Map() };
    },
    executeWithInvocation: async () => executeResult(),
  }));

describe("official STRK20 SDK broadcast scope", () => {
  test("blocks a retry when an account-mode broadcast has an indeterminate outcome", async () => {
    const maturityStore = memoryStrk20MaturityStore();
    let broadcasts = 0;
    const service = createOfficialStrk20Service({
      maturityStore,
      providerFor,
      sdk: depositSdk(),
      // Exactly what `withRpcWrite` throws once the write is in flight and the
      // response is lost; the minting itself is covered in starknet-rpc.test.ts.
      // A write that can be in flight was signed, so it journaled first.
      async submitInvoke(input) {
        broadcasts += 1;
        await input.onSigned?.(signedWrite);
        throw new IndeterminateRpcWriteError(
          "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
        );
      },
    });

    // The curated marker survives the stage mapping unchanged, so maturity still
    // recognizes it — and it carries no request body to redact.
    const rejection = await service.submitActions(depositRequest).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(IndeterminateRpcWriteError);
    expect((rejection as Error).message).toBe(
      "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
    );
    expect(await maturityStore.read(scope)).toEqual({ ...signedWrite, state: "submitting" });
    await expect(service.submitActions(depositRequest)).rejects.toThrow(
      "strk20 services unavailable",
    );
    expect(broadcasts).toBe(1);
  });

  test("lets the next action proceed when the lost account-mode send was never signed", async () => {
    const maturityStore = memoryStrk20MaturityStore();
    let broadcasts = 0;
    const service = createOfficialStrk20Service({
      maturityStore,
      providerFor,
      sdk: depositSdk(),
      // A transport failure before the invoke is signed (estimation, the nonce
      // read): the journal never ran, so nothing can be on its way.
      async submitInvoke() {
        broadcasts += 1;
        if (broadcasts === 1) {
          throw new IndeterminateRpcWriteError(
            "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
          );
        }
        return { calls: [], transactionHash: "0x777" };
      },
    });

    await expect(service.submitActions(depositRequest)).rejects.toBeInstanceOf(
      IndeterminateRpcWriteError,
    );
    expect(await maturityStore.read(scope)).toEqual({ route: "account", state: "submitting" });

    await expect(service.submitActions(depositRequest)).resolves.toMatchObject({
      transactionHash: "0x777",
    });
    expect(broadcasts).toBe(2);
  });

  test("frees the scope when every endpoint fails the pre-broadcast chain-id probe", async () => {
    const maturityStore = memoryStrk20MaturityStore();
    const probed: string[] = [];
    let entered = 0;
    // Endpoint selection is a read-only probe, so its failure means no
    // transaction was ever broadcast. The raw failure carries the endpoint and a
    // proof-like blob, both of which must be redacted before reaching a caller.
    const probeFailingProviderFor = (nodeUrl: string): RpcProvider =>
      ({
        ...providerFor(),
        getChainId: async () => {
          probed.push(nodeUrl);
          throw new Error(
            `Failed to fetch ${nodeUrl} for proof UHJvb2ZCbG9iQmFzZTY0ZGF0YVBhZGRpbmc`,
          );
        },
        getClassHashAt: async () => {
          entered += 1;
          return "0xdef";
        },
      }) as unknown as RpcProvider;
    const service = createOfficialStrk20Service({
      maturityStore,
      providerFor,
      sdk: depositSdk(),
      submitInvoke: async (input) => submitInvokeTransaction(input, probeFailingProviderFor),
    });

    const rejection = await service
      .submitActions({
        ...depositRequest,
        rpcUrls: ["https://first.example", "https://second.example"],
      })
      .catch((error: unknown) => error);

    // Nothing was submitted, so the failure must not be dressed as indeterminate.
    expect(rejection).toBeInstanceOf(WalletError);
    expect(rejection).not.toBeInstanceOf(IndeterminateRpcWriteError);
    const surfaced = rejection instanceof Error ? rejection.message : "";
    expect(surfaced).toContain("strk20 services unavailable (submission/transport)");
    expect(surfaced).not.toContain("https://second.example");
    expect(surfaced).not.toContain("UHJvb2ZCbG9iQmFzZTY0ZGF0YVBhZGRpbmc");
    // Every endpoint was probed and the write body never ran.
    expect(probed).toEqual(["https://first.example", "https://second.example"]);
    expect(entered).toBe(0);
    // So the scope is released rather than wedging the browser session on a
    // `submitting` record that no later privacy operation can clear.
    expect(await maturityStore.read(scope)).toBeNull();
  });
});
