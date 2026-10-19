/**
 * A refusal the wallet's own transport proved (HTTP 429 or JSON-RPC -32005)
 * must survive starknet.js's `fetchEndpoint`, which rethrows every fetch
 * failure as `Error(message)` (mc-wallet #660). These tests run real
 * starknet.js providers over scripted endpoints, so they exercise that rewrap
 * rather than a stub that throws the typed error directly.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  createRpcProvider,
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
  RPC_REFUSED_MESSAGE,
  RpcRefusedError,
  resetRpcEndpointCooldownsForTests,
  timedRpcFetch,
  withRpcFallback,
  withRpcWrite,
} from "@bramble/starknet/provider";
import { logger, type RpcProvider } from "starknet";

logger.setLogLevel("FATAL");

const CHAIN_ID = "0x534e5f4d41494e";
const NODE_URL = "https://refusal-boundary.example";
const BROADCASTS = [
  "starknet_addInvokeTransaction",
  "starknet_addDeployAccountTransaction",
  "starknet_addDeclareTransaction",
] as const;

type Answer = () => Promise<Response>;

const answer =
  (body: string, status: number, headers: Record<string, string> = {}): Answer =>
  async () =>
    new Response(body, { headers, status });

const RATE_LIMITED = answer('{"error":"rate_limited"}', 429, { "retry-after": "120" });
const NODE_RATE_LIMIT = answer(
  '{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"rate limit exceeded"}}',
  200,
);

// A real starknet.js provider: the chain-id probe answers normally and every
// other method gets `reply`.
const scripted =
  (reply: Answer) =>
  (nodeUrl: string): RpcProvider =>
    createRpcProvider(nodeUrl, {
      baseFetch: timedRpcFetch(1_000, async (_input, init) => {
        const method = JSON.parse(String(init?.body)).method;
        return method === "starknet_chainId"
          ? new Response(JSON.stringify({ id: 0, jsonrpc: "2.0", result: CHAIN_ID }))
          : reply();
      }),
    });

const fetchThroughChannel = (provider: RpcProvider, method: string): Promise<unknown> => {
  const fetchEndpoint = Reflect.get(provider.channel, "fetchEndpoint") as (
    rpcMethod: string,
    params?: unknown,
  ) => Promise<unknown>;
  return fetchEndpoint.call(provider.channel, method, {});
};

const broadcastFailure = (reply: Answer, method: string): Promise<unknown> =>
  withRpcWrite([NODE_URL], CHAIN_ID, (p) => fetchThroughChannel(p, method), scripted(reply)).catch(
    (error: unknown) => error,
  );

describe("a proven refusal survives the starknet.js rewrap", () => {
  beforeEach(() => resetRpcEndpointCooldownsForTests());

  test("a 429 or -32005 on any broadcast is a refusal, never outcome-unknown", async () => {
    for (const reply of [RATE_LIMITED, NODE_RATE_LIMIT]) {
      for (const method of BROADCASTS) {
        resetRpcEndpointCooldownsForTests();
        const rejection = await broadcastFailure(reply, method);
        // A deploy that reads as outcome-unknown is recorded as possibly
        // deployed, which burns its counterfactual address.
        expect(rejection).not.toBeInstanceOf(IndeterminateRpcWriteError);
        expect(rejection).toBeInstanceOf(WalletError);
        expect((rejection as Error).message).toBe(RPC_REFUSED_MESSAGE);
      }
    }
  });

  test("a refused read keeps its Retry-After cooldown", async () => {
    let clock = 0;
    let calls = 0;
    const run = (provider: RpcProvider) => {
      calls += 1;
      return fetchThroughChannel(provider, "starknet_getNonce");
    };
    const rejection = await withRpcFallback(
      [NODE_URL],
      run,
      scripted(RATE_LIMITED),
      () => clock,
      () => 0,
    ).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(RpcRefusedError);
    expect((rejection as RpcRefusedError).retryAfter).toBe("120");

    // Past the 30 s default but inside the endpoint's 120 s: still cooling.
    clock = 60_000;
    await withRpcFallback([NODE_URL], run, scripted(RATE_LIMITED), () => clock).catch(() => null);
    expect(calls).toBe(1);

    clock = 121_000;
    await withRpcFallback([NODE_URL], run, scripted(RATE_LIMITED), () => clock).catch(() => null);
    expect(calls).toBe(2);
  });

  test("concurrent requests on one channel each keep their own outcome", async () => {
    let n = 0;
    const provider = scripted(async () => {
      n += 1;
      return n === 1
        ? new Response('{"error":"rate_limited"}', { status: 429 })
        : new Response(JSON.stringify({ id: 1, jsonrpc: "2.0", result: "0x7" }));
    })(NODE_URL);
    const [refused, answered] = await Promise.allSettled([
      fetchThroughChannel(provider, "starknet_getNonce"),
      fetchThroughChannel(provider, "starknet_getNonce"),
    ]);
    expect(refused.status === "rejected" && refused.reason).toBeInstanceOf(RpcRefusedError);
    expect(answered).toEqual({ status: "fulfilled", value: "0x7" });
  });
});

describe("nothing a node says can make a broadcast read as refused", () => {
  beforeEach(() => resetRpcEndpointCooldownsForTests());

  test("a node error quoting the refusal sentence stays outcome-unknown", async () => {
    const quoting = [
      answer(JSON.stringify({ error: RPC_REFUSED_MESSAGE, id: 1, jsonrpc: "2.0" }), 200),
      answer(JSON.stringify({ error: RPC_REFUSED_MESSAGE }), 502),
      answer(RPC_REFUSED_MESSAGE, 503),
    ];
    for (const reply of quoting) {
      for (const method of BROADCASTS) {
        resetRpcEndpointCooldownsForTests();
        const rejection = await broadcastFailure(reply, method);
        expect(rejection).toBeInstanceOf(IndeterminateRpcWriteError);
        expect((rejection as Error).message).toBe(INDETERMINATE_RPC_WRITE_MESSAGE);
      }
    }
  });

  test("an untyped transport failure with the refusal text stays outcome-unknown", async () => {
    const rejection = await broadcastFailure(async () => {
      throw new Error(RPC_REFUSED_MESSAGE);
    }, "starknet_addDeployAccountTransaction");
    expect(rejection).toBeInstanceOf(IndeterminateRpcWriteError);
  });
});
