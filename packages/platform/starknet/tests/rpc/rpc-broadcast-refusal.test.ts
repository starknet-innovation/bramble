/**
 * A broadcast that fails at a gateway is only a determinate refusal when the
 * endpoint proved it turned the request away (HTTP 429 or JSON-RPC -32005). A
 * proxy 5xx with a small `error` body can follow a node that already accepted
 * the transaction, so it must stay outcome-unknown, never "Nothing was submitted".
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  createRpcProvider,
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
  isTransportRpcError,
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
const NODE_URL = "https://broadcast-refusal.example";

type Answer = { readonly body: string; readonly status: number };

// A real starknet.js provider over a scripted endpoint: the chain-id probe
// answers normally and every other method gets `answer`.
const scriptedProvider =
  (answer: Answer) =>
  (nodeUrl: string): RpcProvider =>
    createRpcProvider(nodeUrl, {
      baseFetch: timedRpcFetch(1_000, async (_input, init) => {
        const method = JSON.parse(String(init?.body)).method;
        if (method === "starknet_chainId") {
          return new Response(JSON.stringify({ id: 0, jsonrpc: "2.0", result: CHAIN_ID }));
        }
        return new Response(answer.body, { status: answer.status });
      }),
    });

const fetchThroughChannel = (provider: RpcProvider, method: string): Promise<unknown> => {
  const fetchEndpoint = Reflect.get(provider.channel, "fetchEndpoint") as (
    rpcMethod: string,
    params?: unknown,
  ) => Promise<unknown>;
  return fetchEndpoint.call(provider.channel, method, {});
};

const broadcastFailure = (answer: Answer): Promise<unknown> =>
  withRpcWrite(
    [NODE_URL],
    CHAIN_ID,
    (selected) => fetchThroughChannel(selected, "starknet_addInvokeTransaction"),
    scriptedProvider(answer),
  ).catch((error: unknown) => error);

const GATEWAY_TIMEOUT = { body: '{"error":"upstream timeout"}', status: 502 } as const;

const rpcBody = (method: string): string => JSON.stringify({ id: 1, jsonrpc: "2.0", method });

const transportOutcome = (answer: Answer, method: string): Promise<unknown> =>
  timedRpcFetch(1_000, async () => new Response(answer.body, { status: answer.status }))(NODE_URL, {
    body: rpcBody(method),
    method: "POST",
  }).catch((error: unknown) => error);

describe("broadcast refusals are only what the endpoint proved", () => {
  beforeEach(() => resetRpcEndpointCooldownsForTests());

  test("the transport does not call a proxy error string on a broadcast a refusal", async () => {
    for (const method of [
      "starknet_addInvokeTransaction",
      "starknet_addDeployAccountTransaction",
      "starknet_addDeclareTransaction",
    ]) {
      for (const status of [502, 504, 200]) {
        const outcome = await transportOutcome({ ...GATEWAY_TIMEOUT, status }, method);
        expect(outcome).toBeInstanceOf(Response);
        expect((outcome as Response).status).toBe(status);
      }
    }
  });

  test("a proxy 502 with a JSON error string on a broadcast is outcome-unknown", async () => {
    for (const status of [502, 504, 200]) {
      resetRpcEndpointCooldownsForTests();
      const rejection = await broadcastFailure({ ...GATEWAY_TIMEOUT, status });
      expect(rejection).toBeInstanceOf(IndeterminateRpcWriteError);
      expect((rejection as Error).message).toBe(INDETERMINATE_RPC_WRITE_MESSAGE);
      expect((rejection as Error).message).not.toContain("Nothing was submitted");
    }
  });

  test("an HTTP 429 or JSON-RPC -32005 on a broadcast is still a refusal", async () => {
    const rateLimited = [
      { body: '{"error":"rate_limited"}', status: 429 },
      {
        body: '{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"rate limit exceeded"}}',
        status: 503,
      },
    ];
    for (const answer of rateLimited) {
      const outcome = await transportOutcome(answer, "starknet_addInvokeTransaction");
      expect(outcome).toBeInstanceOf(RpcRefusedError);
      expect((outcome as Error).message).toBe(RPC_REFUSED_MESSAGE);
    }
  });

  test("a read that gets the same 502 is still a refusal and fails over", async () => {
    for (const init of [{ body: rpcBody("starknet_getNonce") }, {}]) {
      const outcome = await timedRpcFetch(
        1_000,
        async () =>
          new Response(GATEWAY_TIMEOUT.body, {
            status: GATEWAY_TIMEOUT.status,
          }),
      )(NODE_URL, init).catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(RpcRefusedError);
    }

    const urls = ["https://first-refusing.example", "https://second-refusing.example"];
    const seen: string[] = [];
    const rejection = await withRpcFallback(
      urls,
      async (provider) => {
        seen.push(provider.channel.nodeUrl);
        return fetchThroughChannel(provider, "starknet_getNonce");
      },
      scriptedProvider(GATEWAY_TIMEOUT),
    ).catch((error: unknown) => error);

    expect(isTransportRpcError(rejection)).toBe(true);
    expect((rejection as Error).message).toBe(RPC_REFUSED_MESSAGE);
    expect(seen).toEqual(urls);
  });
});
