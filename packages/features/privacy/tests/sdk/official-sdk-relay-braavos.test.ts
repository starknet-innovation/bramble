/**
 * A Braavos account the wallet cannot sign for (a 2FA signer, or a live class
 * that is not a Braavos implementation release) is refused by the private
 * relay before the key is used, not after a signature has been produced.
 */
import { expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { buildErc20ApproveCall } from "@bramble/starknet/rpc-assets";
import {
  BRAAVOS_BASE_CLASS_HASH,
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
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

const STRONG_SIGNERS = ["0x1", relayContext.account.publicKeyX, "0x1", "0xaa", "0x0"];
const STARK_ONLY = ["0x1", relayContext.account.publicKeyX, "0x0", "0x0"];

// Quotes and submits one deposit for a Braavos account whose live class and
// signer list are the given ones; resolves to the submit outcome and how many
// times the key signed.
const relayBraavos = async (liveClass: string, signers: readonly string[]) => {
  let signed = 0;
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
        getBlock: async () => ({ block_hash: "0x9", timestamp: 1 }),
        getBlockLatestAccepted: async () => ({ block_hash: "0x9", block_number: 1 }),
        getClassHashAt: async () => liveClass,
        callContract: async (
          request: { readonly entrypoint: string },
          blockIdentifier?: string,
        ) => {
          if (request.entrypoint === "get_signers") return [...signers];
          if (request.entrypoint === "get_deferred_remove_signers") return ["0x0"];
          // Everything else (pool fee reads) keeps the base provider's answers.
          return (provider as unknown as RpcProvider).callContract(
            request as never,
            blockIdentifier as never,
          );
        },
      } as unknown as RpcProvider;
    },
    sdk: runtime(() => ({
      build: () => builder(),
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
  const outcome = await service.submitActions({ ...braavosContext, actions, plan }).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  return { outcome, signed };
};

test("refuses a private relay for a 2FA Braavos account before using the key", async () => {
  // A strong signer refuses at the live check, before the key is ever touched
  // (issue 542 family).
  const relay = await relayBraavos(BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH, STRONG_SIGNERS);
  expect(relay.outcome).toContain("active 2FA signer");
  expect(relay.signed).toBe(0);
});

test("refuses a private relay when the live class is a Braavos base class", async () => {
  // Stark-only signers, but the account reports a deployment class rather than
  // an implementation release this wallet signs for.
  const relay = await relayBraavos(BRAAVOS_BASE_CLASS_HASH, STARK_ONLY);
  expect(relay.outcome).toContain("not a release this wallet recognizes");
  expect(relay.signed).toBe(0);
});
