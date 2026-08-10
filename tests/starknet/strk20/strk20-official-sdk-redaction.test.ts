/** Account-mode submission errors must never disclose a proof-bearing request. */
import { describe, expect, test } from "bun:test";
import { WalletError } from "../../../src/shared/errors";
import { memoryStrk20MaturityStore } from "../../../src/starknet/strk20/maturity";
import { createOfficialStrk20Service } from "../../../src/starknet/strk20/official-sdk-service";
import {
  STRK20_SDK_ACCOUNT as account,
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  STRK20_POOL_ADDRESS as poolAddress,
  providerFor,
  sdkRuntime as runtime,
  STRK20_SDK_TOKEN as token,
} from "../../support/strk20-official-sdk";

describe("official STRK20 SDK submission redaction", () => {
  test("surfaces an account-mode deposit rejection without echoing the request body", async () => {
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const maturityStore = memoryStrk20MaturityStore();
    const requestBody =
      '{"calldata":["0xfeedfacedeadbeef1234"],"proof":"UHJvb2ZCbG9iQmFzZTY0ZGF0YQ"}';
    const service = createOfficialStrk20Service({
      maturityStore,
      providerFor,
      sdk,
      async submitInvoke() {
        throw Object.assign(
          new Error(`RPC: starknet_addInvokeTransaction with params ${requestBody}`),
          {
            baseError: {
              code: 41,
              data: { execution_error: "pool/deposit-cap-reached" },
              message: "Transaction execution error",
            },
          },
        );
      },
    });

    const rejection = await service
      .submitActions({
        ...context,
        actions: [{ amount: "0x1", token, type: "deposit" }],
        plan: { mode: "account", poolFeeFri: "0x0" },
      })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(WalletError);
    const surfaced = rejection instanceof Error ? rejection.message : "";
    expect(surfaced).toContain(
      "(submission/execution-reverted): 41 Transaction execution error pool/deposit-cap-reached",
    );
    expect(surfaced).not.toContain("starknet_addInvokeTransaction");
    expect(surfaced).not.toContain("0xfeedfacedeadbeef1234");
    expect(surfaced).not.toContain("UHJvb2ZCbG9iQmFzZTY0ZGF0YQ");
    expect(
      await maturityStore.read({
        accountId: account.id,
        networkId: account.networkId,
        poolAddress,
      }),
    ).toBeNull();
  });
});
