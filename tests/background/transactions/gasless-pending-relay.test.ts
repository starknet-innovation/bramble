/**
 * A gasless execute records its outside-execution nonce before the post.
 * A storage failure skips the post. A lost reply leaves the row, and the
 * existing nonce view reconciles it.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  IndeterminateRpcWriteError,
  resetRpcEndpointCooldownsForTests,
} from "@bramble/starknet/provider";
import { INVOKE_NOT_JOURNALED } from "@bramble/starknet/rpc-submit";
import { GASLESS_RPC_ID } from "@bramble/transactions/gasless-rpc";
import { submitReviewedGaslessInvoke } from "@bramble/transactions/gasless-submit";
import { memoryRelaySignatureLog } from "@bramble/transactions/relay-signatures";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { type Call, OutsideExecutionVersion, outsideExecution, type RpcProvider } from "starknet";
import { recordRequiredRelaySignature } from "../../../apps/extension/src/background/transactions/relay-record";
import { refreshRelaySignatures } from "../../../apps/extension/src/background/transactions/relay-status";

const ACCOUNT = "0x5dccf9cfdcabb9e4ef45814bda1b056bb23063d0e9b64e5a845e9dfb3d23f10";
const FORWARDER = "0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f";
const USDC = "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const RECIPIENT = "0x5ef2de1a7ccc0e9ef8d1a1e6e9c4c2b5d6a7f8e9d0c1b2a3f4e5d6c7b8a9f01";
const BEFORE = "0x6ae06b9d";
const NOW = Number(BigInt(BEFORE)) - 120;
const URL = "https://wallet.example/api/paymaster/mainnet";
const ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const scope = { accountId: `SN_MAIN:${ADDRESS}`, networkId: "SN_MAIN" } as const;

const userCall = (): Call => ({
  calldata: [RECIPIENT, "0x10", "0x0"],
  contractAddress: USDC,
  entrypoint: "transfer",
});

const typed = () => {
  const fee: Call = {
    calldata: [FORWARDER, "0x3e8", "0x0"],
    contractAddress: USDC,
    entrypoint: "transfer",
  };
  return outsideExecution.getTypedData(
    "SN_MAIN",
    { caller: FORWARDER, execute_after: "0x1", execute_before: BEFORE },
    "0x5",
    [userCall(), fee],
    OutsideExecutionVersion.V2,
  );
};

const quoteBody = () => ({
  fee: {
    estimated_fee_in_gas_token: "0x1",
    estimated_fee_in_strk: "0x1",
    gas_token_price_in_strk: "0x1",
    suggested_max_fee_in_gas_token: "0x3e8",
    suggested_max_fee_in_strk: "0x1",
  },
  parameters: { fee_mode: { gas_token: USDC, mode: "default" }, version: "0x1" },
  type: "invoke",
  typed_data: typed(),
});

const json = (result: unknown): Response =>
  new Response(JSON.stringify({ id: GASLESS_RPC_ID, jsonrpc: "2.0", result }), { status: 200 });

beforeEach(() => resetRpcEndpointCooldownsForTests());

describe("gasless nonce recorded before execute", () => {
  test("a lost execute reply leaves the pending row, which the nonce view can close", async () => {
    const log = memoryRelaySignatureLog(() => 5_000);
    const methods: string[] = [];
    const run = submitReviewedGaslessInvoke({
      account: {
        accountContractType: "argent",
        address: ACCOUNT,
        classHash: ARGENT_ACCOUNT_CLASS_HASH,
        deployed: true,
      },
      beforeExecute: async (signed) => {
        await recordRequiredRelaySignature(log, {
          account: {
            accountContractType: "argent",
            id: scope.accountId,
            networkId: "SN_MAIN",
          },
          messageHash: signed.messageHash,
          origin: "Bramble",
          typedData: signed.typedData,
          userFee: { amount: signed.userFee.amount, decimals: 6, token: signed.userFee.token },
        });
      },
      calls: [userCall()],
      deployment: null,
      http: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { method?: string };
        const method = body.method ?? "";
        methods.push(method);
        if (method === "paymaster_executeTransaction") {
          expect(await log.list(scope)).toHaveLength(1);
          return new Response("nope", { status: 400 });
        }
        return json(quoteBody());
      },
      isAuthorized: () => true,
      nowSeconds: NOW,
      readNowSeconds: () => NOW,
      referenceFor: async () => 1000n,
      reviewed: { amount: "2000", decimals: 6, label: "USDC", tokenAddress: USDC },
      route: { chainId: "SN_MAIN", enabled: true, forwarder: FORWARDER, url: URL },
      signHash: async () => ({ publicKey: "0x3", r: "0x1", s: "0x2" }),
    });
    await expect(run).rejects.toBeInstanceOf(IndeterminateRpcWriteError);
    expect(methods).toEqual(["paymaster_buildTransaction", "paymaster_executeTransaction"]);
    const [pending] = await log.list(scope);
    expect(pending).toMatchObject({
      nonce: "0x5",
      origin: "Bramble",
      status: "signed",
      userFee: { amount: "1000", decimals: 6, token: "USDC" },
    });
    const asked: {
      readonly calldata?: readonly string[];
      readonly contractAddress?: string;
      readonly entrypoint?: string;
    }[] = [];
    const provider = {
      async callContract(call: {
        readonly calldata: readonly string[];
        readonly contractAddress: string;
        readonly entrypoint: string;
      }) {
        asked.push(call);
        return ["0x0"];
      },
    } as unknown as RpcProvider;
    const now = ((pending?.executeBefore ?? 0) - 100) * 1000;
    const refreshed = await refreshRelaySignatures(
      { log, rpcProviderFor: () => provider },
      { address: ADDRESS, rpcUrls: ["https://rpc.example"], scope },
      now,
    );
    expect(asked).toEqual([
      {
        calldata: ["0x5"],
        contractAddress: ADDRESS,
        entrypoint: "is_valid_outside_execution_nonce",
      },
    ]);
    expect(refreshed[0]).toMatchObject({
      status: "nonce-used",
      userFee: { amount: "1000", decimals: 6, token: "USDC" },
    });
  });

  test("a log that cannot store the row skips the execute post", async () => {
    const methods: string[] = [];
    const run = submitReviewedGaslessInvoke({
      account: {
        accountContractType: "argent",
        address: ACCOUNT,
        classHash: ARGENT_ACCOUNT_CLASS_HASH,
        deployed: true,
      },
      beforeExecute: async (signed) => {
        await recordRequiredRelaySignature(
          {
            async list() {
              return [];
            },
            async record() {
              return undefined;
            },
          },
          {
            account: {
              accountContractType: "argent",
              id: scope.accountId,
              networkId: "SN_MAIN",
            },
            messageHash: signed.messageHash,
            origin: "Bramble",
            typedData: signed.typedData,
            userFee: { amount: signed.userFee.amount, decimals: 6, token: "USDC" },
          },
        );
      },
      calls: [userCall()],
      deployment: null,
      http: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { method?: string };
        methods.push(body.method ?? "");
        return json(quoteBody());
      },
      isAuthorized: () => true,
      nowSeconds: NOW,
      readNowSeconds: () => NOW,
      referenceFor: async () => 1000n,
      reviewed: { amount: "2000", decimals: 6, label: "USDC", tokenAddress: USDC },
      route: { chainId: "SN_MAIN", enabled: true, forwarder: FORWARDER, url: URL },
      signHash: async () => ({ publicKey: "0x3", r: "0x1", s: "0x2" }),
    });
    const error = await run.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WalletError);
    if (error instanceof WalletError) {
      expect(error.message).toBe(INVOKE_NOT_JOURNALED);
    }
    expect(methods).toEqual(["paymaster_buildTransaction"]);
  });
});
