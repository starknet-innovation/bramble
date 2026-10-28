/**
 * The execute path re-reads the clock after signing, and Activity's fee is the
 * amount in the signed quote, which may be below the reviewed maximum.
 */
import { describe, expect, test } from "bun:test";
import { GASLESS_RPC_ID } from "@bramble/privacy/gasless-rpc";
import { submitReviewedGaslessInvoke } from "@bramble/privacy/gasless-submit";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { type Call, OutsideExecutionVersion, outsideExecution } from "starknet";

const ACCOUNT = "0x5dccf9cfdcabb9e4ef45814bda1b056bb23063d0e9b64e5a845e9dfb3d23f10";
const FORWARDER = "0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f";
const USDC = "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const RECIPIENT = "0x5ef2de1a7ccc0e9ef8d1a1e6e9c4c2b5d6a7f8e9d0c1b2a3f4e5d6c7b8a9f01";
const BEFORE = "0x6ae06b9d";
/** Inside the ten-minute cap, with the ten-second floor still remaining. */
const NOW = Number(BigInt(BEFORE)) - 120;
const URL = "https://wallet.example/api/paymaster/mainnet";

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

const submit = (
  readNowSeconds: () => number,
  onCall: (method: string) => Response,
  beforeExecute?: (signed: {
    readonly messageHash: string;
    readonly typedData: unknown;
  }) => Promise<void>,
) => {
  let signed = 0;
  const methods: string[] = [];
  const run = submitReviewedGaslessInvoke({
    account: {
      accountContractType: "argent",
      address: ACCOUNT,
      classHash: ARGENT_ACCOUNT_CLASS_HASH,
      deployed: true,
    },
    calls: [userCall()],
    deployment: null,
    http: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      const method = body.method ?? "";
      methods.push(method);
      return onCall(method);
    },
    isAuthorized: () => true,
    nowSeconds: NOW,
    readNowSeconds,
    referenceFor: async () => 1000n,
    reviewed: { amount: "2000", decimals: 6, label: "USDC", tokenAddress: USDC },
    route: { chainId: "SN_MAIN", enabled: true, forwarder: FORWARDER, url: URL },
    ...(beforeExecute ? { beforeExecute } : {}),
    signHash: async () => {
      signed += 1;
      return { publicKey: "0x3", r: "0x1", s: "0x2" };
    },
  });
  return { methods, run, signed: () => signed };
};

const json = (result: unknown): Response =>
  new Response(JSON.stringify({ id: GASLESS_RPC_ID, jsonrpc: "2.0", result }), { status: 200 });

describe("submitReviewedGaslessInvoke", () => {
  test("refuses an expired window read after signing and does not execute", async () => {
    const { methods, run, signed } = submit(
      () => Number(BigInt(BEFORE)),
      () => json(quoteBody()),
    );
    await expect(run).rejects.toMatchObject({ code: "invalid_screening_transaction" });
    expect(signed()).toBe(1);
    expect(methods).toEqual(["paymaster_buildTransaction"]);
  });

  test("refuses a window longer than ten minutes after signing and does not execute", async () => {
    const { methods, run, signed } = submit(
      () => Number(BigInt(BEFORE)) - 601,
      () => json(quoteBody()),
    );
    await expect(run).rejects.toMatchObject({ code: "invalid_screening_transaction" });
    expect(signed()).toBe(1);
    expect(methods).toEqual(["paymaster_buildTransaction"]);
  });

  test("persists the outside execution before execute", async () => {
    const order: string[] = [];
    const posted = submit(
      () => NOW,
      (method) => {
        order.push(method);
        return method === "paymaster_executeTransaction"
          ? json({ transaction_hash: "0x3" })
          : json(quoteBody());
      },
      async () => {
        order.push("record");
      },
    );
    await expect(posted.run).resolves.toMatchObject({ transactionHash: "0x3" });
    expect(order).toEqual(["paymaster_buildTransaction", "record", "paymaster_executeTransaction"]);
  });

  test("a failure while persisting skips the execute post", async () => {
    const methods: string[] = [];
    const blocked = submit(
      () => NOW,
      (method) => {
        methods.push(method);
        return json(quoteBody());
      },
      async () => {
        throw new Error("not stored");
      },
    );
    await expect(blocked.run).rejects.toThrow("not stored");
    expect(methods).toEqual(["paymaster_buildTransaction"]);
  });

  test("records the signed quote, which can be below the reviewed maximum", async () => {
    const { run } = submit(
      () => NOW,
      (method) =>
        method === "paymaster_executeTransaction"
          ? json({ transaction_hash: "0x3" })
          : json(quoteBody()),
    );
    await expect(run).resolves.toMatchObject({
      transactionHash: "0x3",
      userFee: { amount: "1000", token: "USDC", tokenAddress: USDC },
    });
  });
});
