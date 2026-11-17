/**
 * Mocked mainnet paymaster. Builds SNIP-9 v2 typed data from the wallet's
 * own build request so the handler checks a body it could have been given.
 */
import { isRecord } from "@bramble/core/json";
import { GASLESS_PAYMASTER_URLS } from "@bramble/transactions/gasless-config";
import { GASLESS_RPC_ID } from "@bramble/transactions/gasless-rpc";
import type { PaymasterHttp } from "@bramble/transactions/paymaster-http";
import type { RelaySignatureLog } from "@bramble/transactions/relay-signatures";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";
import { type Call, hash, OutsideExecutionVersion, outsideExecution } from "starknet";
import {
  account,
  type BuildShape,
  FORWARDER,
  type GatewayScript,
  NOW,
  OVER_CEILING,
  type Posted,
  REFERENCE,
  TX_HASH,
  USDC,
} from "./gasless-handler-constants";

const TRANSFER = canonicalFelt(hash.getSelectorFromName("transfer"));

const href = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const json = (result: unknown): Response =>
  new Response(JSON.stringify({ id: GASLESS_RPC_ID, jsonrpc: "2.0", result }), { status: 200 });

const feeFields = (max: bigint) => ({
  estimated_fee_in_gas_token: "0x1",
  estimated_fee_in_strk: "0x1",
  gas_token_price_in_strk: "0x1",
  suggested_max_fee_in_gas_token: `0x${max.toString(16)}`,
  suggested_max_fee_in_strk: "0x1",
});

const oneCall = (call: unknown): Call => {
  if (
    !isRecord(call) ||
    typeof call["to"] !== "string" ||
    typeof call["selector"] !== "string" ||
    !Array.isArray(call["calldata"]) ||
    TRANSFER === null ||
    !sameFelt(call["selector"], TRANSFER)
  ) {
    throw new Error("build call is not a transfer");
  }
  return {
    calldata: call["calldata"].map((item) => String(item)),
    contractAddress: call["to"],
    entrypoint: "transfer",
  };
};

const userCalls = (params: unknown): readonly Call[] => {
  if (!isRecord(params) || !isRecord(params["transaction"])) {
    throw new Error("build params");
  }
  const invoke = params["transaction"]["invoke"];
  if (!isRecord(invoke) || !Array.isArray(invoke["calls"])) {
    throw new Error("build invoke");
  }
  return invoke["calls"].map(oneCall);
};

const feeToken = (params: unknown): string => {
  if (!isRecord(params) || !isRecord(params["parameters"])) {
    throw new Error("build parameters");
  }
  const mode = params["parameters"]["fee_mode"];
  if (!isRecord(mode) || mode["mode"] !== "default" || typeof mode["gas_token"] !== "string") {
    throw new Error("fee mode was not default");
  }
  return mode["gas_token"];
};

const typedQuote = (params: unknown, amount: bigint, caller: string) => {
  const calls = userCalls(params);
  const token = feeToken(params);
  const fee: Call = {
    calldata: [caller, `0x${amount.toString(16)}`, "0x0"],
    contractAddress: token,
    entrypoint: "transfer",
  };
  return {
    fee: feeFields(amount),
    parameters: { fee_mode: { gas_token: token, mode: "default" }, version: "0x1" },
    type: "invoke" as const,
    typed_data: outsideExecution.getTypedData(
      "SN_MAIN",
      { caller, execute_after: "0x1", execute_before: `0x${(NOW + 120).toString(16)}` },
      "0x5",
      [...calls, fee],
      OutsideExecutionVersion.V2,
    ),
  };
};

const deployResult = () => ({
  deployment: {
    address: account.address,
    calldata: [],
    class_hash: "0x1",
    salt: "0x1",
    version: 1,
  },
  fee: feeFields(REFERENCE),
  parameters: { fee_mode: { gas_token: USDC, mode: "default" }, version: "0x1" },
  type: "deploy_and_invoke" as const,
  typed_data: {},
});

const buildResult = (params: unknown, shape: BuildShape) => {
  switch (shape) {
    case "invoke":
      return typedQuote(params, REFERENCE, FORWARDER);
    case "deploy_and_invoke":
      return deployResult();
    case "over-ceiling":
      return typedQuote(params, OVER_CEILING, FORWARDER);
    case "wrong-forwarder":
      return typedQuote(params, REFERENCE, "0x9");
    default: {
      const unreachable: never = shape;
      return unreachable;
    }
  }
};

const executeResponse = (execute: GatewayScript["execute"]): Response =>
  execute === "ok"
    ? json({ transaction_hash: TX_HASH })
    : new Response(JSON.stringify({ error: execute.code }), { status: execute.status });

/**
 * Paymaster transport for one harness. Records every call and answers from
 * `script`. The first build uses `firstBuild`; later builds use `laterBuild`.
 */
export const createPaymasterHttp = (input: {
  readonly posts: Posted[];
  readonly relay: RelaySignatureLog;
  readonly relayAtExecute: number[];
  readonly script: GatewayScript;
}): PaymasterHttp => {
  const { posts, relay, relayAtExecute, script } = input;
  return async (request, init) => {
    const url = href(request);
    if (url !== GASLESS_PAYMASTER_URLS.SN_MAIN) {
      throw new Error(`unexpected paymaster url ${url}`);
    }
    const body = JSON.parse(String(init?.body)) as { method?: string; params?: unknown };
    const method = body.method ?? "";
    posts.push({ method, params: body.params, url });
    if (method === "paymaster_executeTransaction") {
      const rows = await relay.list({ accountId: account.id, networkId: "SN_MAIN" });
      relayAtExecute.push(rows.length);
      return executeResponse(script.execute);
    }
    if (method === "paymaster_isAvailable") {
      return json(script.available);
    }
    if (method === "paymaster_getSupportedTokens") {
      return json([{ decimals: 6, price_in_strk: "0x1", token_address: USDC }]);
    }
    if (method === "paymaster_buildTransaction") {
      const count = posts.filter((post) => post.method === "paymaster_buildTransaction").length;
      const shape = count === 1 ? script.firstBuild : script.laterBuild;
      return json(buildResult(body.params, shape));
    }
    throw new Error(`unexpected paymaster method ${method}`);
  };
};
