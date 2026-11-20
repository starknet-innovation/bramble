/**
 * Scripted Starknet JSON-RPC for extension E2E tests: answers the reads and
 * broadcasts a send needs, so approve-and-submit paths run with egress blocked.
 *
 * Installed with `context.route`, so it only ever sees requests the suite-wide
 * DNS blackhole would otherwise fail. Every broadcast is recorded rather than
 * forwarded; nothing here can reach a real node. Unknown methods get a JSON-RPC
 * error and are listed in `unhandled` so a new dependency shows up in the
 * failing test instead of as a silent stall.
 */
import { ARGENT_ACCOUNT_CONTRACT } from "@bramble/starknet/account-contracts";
import type { BrowserContext, Route } from "@playwright/test";
import { EDAMode, hash } from "starknet";

type RpcCall = { readonly id?: unknown; readonly method?: unknown; readonly params?: unknown };

/** Handle onto a running fake chain. */
export type FakeChain = {
  /** Every broadcast in arrival order, with its raw params. */
  readonly broadcasts: readonly { readonly method: string; readonly params: unknown }[];
  /** Distinct methods the fake does not answer. */
  readonly unhandled: ReadonlySet<string>;
  readonly stop: () => Promise<void>;
};

const SN_MAIN = "0x534e5f4d41494e";
/** Balance every token reports for every holder: 1000 tokens at 18 decimals. */
const RICH = "0x3635c9adc5dea00000";
const GAS_PRICE = "0x1";

const feeEstimate = {
  l1_data_gas_consumed: "0x80",
  l1_data_gas_price: GAS_PRICE,
  l1_gas_consumed: "0x0",
  l1_gas_price: GAS_PRICE,
  l2_gas_consumed: "0x100000",
  l2_gas_price: GAS_PRICE,
  overall_fee: "0x100080",
  unit: "FRI",
};

type Bounds = Record<string, { readonly max_amount: string; readonly max_price_per_unit: string }>;
type InvokeV3 = {
  readonly account_deployment_data: string[];
  readonly calldata: string[];
  readonly fee_data_availability_mode: "L1" | "L2";
  readonly nonce: string;
  readonly nonce_data_availability_mode: "L1" | "L2";
  readonly paymaster_data: string[];
  readonly proof_facts?: string[];
  readonly resource_bounds: Bounds;
  readonly sender_address: string;
  readonly tip: string;
};

// The wallet recomputes the hash it signed and refuses a node that reports a
// different one, so the fake must answer with the real v3 hash.
const daMode = (mode: "L1" | "L2") => (mode === "L1" ? EDAMode.L1 : EDAMode.L2);

const invokeHash = (tx: InvokeV3): string =>
  hash.calculateInvokeTransactionHash({
    accountDeploymentData: tx.account_deployment_data,
    chainId: SN_MAIN,
    compiledCalldata: tx.calldata,
    feeDataAvailabilityMode: daMode(tx.fee_data_availability_mode),
    nonce: tx.nonce,
    nonceDataAvailabilityMode: daMode(tx.nonce_data_availability_mode),
    paymasterData: tx.paymaster_data,
    ...(tx.proof_facts ? { proofFacts: tx.proof_facts } : {}),
    resourceBounds: Object.fromEntries(
      Object.entries(tx.resource_bounds).map(([key, bound]) => [
        key,
        {
          max_amount: BigInt(bound.max_amount),
          max_price_per_unit: BigInt(bound.max_price_per_unit),
        },
      ]),
    ) as Parameters<typeof hash.calculateInvokeTransactionHash>[0]["resourceBounds"],
    senderAddress: tx.sender_address,
    tip: tx.tip,
    version: "0x3",
  });

const block = (number: number) => ({
  block_hash: `0x${(number + 1).toString(16)}`,
  block_number: number,
  l1_da_mode: "BLOB",
  l1_data_gas_price: { price_in_fri: GAS_PRICE, price_in_wei: GAS_PRICE },
  l1_gas_price: { price_in_fri: GAS_PRICE, price_in_wei: GAS_PRICE },
  l2_gas_price: { price_in_fri: GAS_PRICE, price_in_wei: GAS_PRICE },
  new_root: "0x1",
  parent_hash: "0x1",
  sequencer_address: "0x1",
  starknet_version: "0.14.0",
  status: "ACCEPTED_ON_L2",
  timestamp: 1_760_000_000,
  transactions: [],
});

/**
 * Routes every HTTPS JSON-RPC POST from the context to an in-memory chain on
 * SN_MAIN where every account is deployed and every token balance is
 * {@link RICH}. Non-RPC requests are aborted, as the blackhole would.
 */
export const startFakeChain = async (context: BrowserContext): Promise<FakeChain> => {
  const broadcasts: { method: string; params: unknown }[] = [];
  const unhandled = new Set<string>();

  const result = (method: string, params: unknown): unknown => {
    switch (method) {
      case "starknet_chainId":
        return SN_MAIN;
      case "starknet_specVersion":
        return "0.10.0";
      case "starknet_blockNumber":
        return 100;
      case "starknet_getBlockWithTxHashes":
        return block(100);
      case "starknet_getNonce":
        return "0x0";
      case "starknet_call":
        return [RICH, "0x0"];
      case "starknet_estimateFee":
        return (params as { request?: unknown[] }).request?.map(() => feeEstimate) ?? [feeEstimate];
      case "starknet_getClassHashAt":
        // Every address is a deployed Argent account: the wallet's own accounts
        // pass its class check, and nothing else asks.
        return ARGENT_ACCOUNT_CONTRACT.classHash;
      case "starknet_addInvokeTransaction":
        broadcasts.push({ method, params });
        return {
          transaction_hash: invokeHash(
            (params as { invoke_transaction: InvokeV3 }).invoke_transaction,
          ),
        };
      case "starknet_getTransactionStatus":
        return { execution_status: "SUCCEEDED", finality_status: "ACCEPTED_ON_L2" };
      case "starknet_getTransactionReceipt":
        return {
          actual_fee: { amount: feeEstimate.overall_fee, unit: "FRI" },
          block_hash: "0x65",
          block_number: 100,
          events: [],
          execution_resources: { l1_data_gas: 128, l1_gas: 0, l2_gas: 1_048_576 },
          execution_status: "SUCCEEDED",
          finality_status: "ACCEPTED_ON_L2",
          messages_sent: [],
          transaction_hash: (params as { transaction_hash?: string }).transaction_hash,
          type: "INVOKE",
        };
      default:
        unhandled.add(method);
        throw { code: -32601, message: "Method not found" };
    }
  };

  const answer = (call: RpcCall): unknown => {
    const id = call.id ?? null;
    try {
      return { id, jsonrpc: "2.0", result: result(String(call.method), call.params) };
    } catch (error) {
      return { error, id, jsonrpc: "2.0" };
    }
  };

  const pattern = "https://**/*";
  const handler = async (route: Route): Promise<void> => {
    const request = route.request();
    let body: unknown = null;
    try {
      body = request.method() === "POST" ? request.postDataJSON() : null;
    } catch {
      body = null;
    }
    if (
      body === null ||
      typeof body !== "object" ||
      (!Array.isArray(body) && !("method" in body))
    ) {
      await route.abort("namenotresolved");
      return;
    }
    await route.fulfill({
      json: Array.isArray(body)
        ? body.map((call) => answer(call as RpcCall))
        : answer(body as RpcCall),
    });
  };
  await context.route(pattern, handler);
  return { broadcasts, stop: () => context.unroute(pattern, handler), unhandled };
};
