/**
 * A broadcast that fails at a gateway is only a determinate refusal when the
 * endpoint proved it turned the request away (HTTP 429 or JSON-RPC -32005). A
 * proxy 5xx with a small `error` body can follow a node that already accepted
 * the transaction, so it must stay outcome-unknown, never "Nothing was submitted".
 * The one exception is the gateway's own coded refusal, written before it
 * forwards: a 4xx `{"error":"<code>"}`, or a 503 screening hold (issue 910).
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
import { RpcGatewayRefusalError } from "@bramble/starknet/rpc-gateway-refusal";
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

// The gateway's refusals on the mainnet submit path (issue 910). None reached a node.
const GATEWAY_REFUSALS = [
  {
    code: "transaction_rejected",
    message: "The network rejected this transaction. Nothing was submitted — review it again.",
    status: 400,
  },
  {
    code: "invalid_screening_transaction",
    message: "The RPC endpoint refused this transaction. Nothing was submitted.",
    status: 400,
  },
  {
    code: "address_not_allowed",
    message: "This account can't send through this RPC endpoint. Nothing was submitted.",
    status: 403,
  },
  {
    code: "screening_denied",
    message:
      "This account can't send through this RPC endpoint for 24 hours. Nothing was submitted.",
    status: 403,
  },
  {
    code: "screening_pending",
    message: "This account's check is still pending. Nothing was submitted — try again shortly.",
    status: 503,
  },
  {
    code: "screening_unavailable",
    message: "This account could not be checked. Nothing was submitted — try again.",
    status: 503,
  },
] as const;

const gatewayAnswer = (code: string, status: number): Answer => ({
  body: JSON.stringify({ error: code }),
  status,
});

describe("a gateway's coded refusal of a broadcast is definitely not sent", () => {
  beforeEach(() => resetRpcEndpointCooldownsForTests());

  test("each gateway code is a determinate refusal with its own reason", async () => {
    for (const refusal of GATEWAY_REFUSALS) {
      resetRpcEndpointCooldownsForTests();
      const rejection = await broadcastFailure(gatewayAnswer(refusal.code, refusal.status));
      expect(rejection).toBeInstanceOf(RpcGatewayRefusalError);
      expect(rejection).not.toBeInstanceOf(IndeterminateRpcWriteError);
      expect(isTransportRpcError(rejection)).toBe(false);
      expect((rejection as RpcGatewayRefusalError).code).toBe(refusal.code);
      expect((rejection as Error).message).toBe(refusal.message);
    }
  });

  test("every broadcast method reads the refusal the same way", async () => {
    for (const method of [
      "starknet_addInvokeTransaction",
      "starknet_addDeployAccountTransaction",
      "starknet_addDeclareTransaction",
    ]) {
      const outcome = await transportOutcome(gatewayAnswer("address_not_allowed", 403), method);
      expect(outcome).toBeInstanceOf(RpcGatewayRefusalError);
    }
  });

  test("an unknown code on a 4xx is still a refusal, with generic copy", async () => {
    const rejection = await broadcastFailure(gatewayAnswer("quota_exhausted", 400));
    expect(rejection).toBeInstanceOf(RpcGatewayRefusalError);
    expect((rejection as Error).message).toBe(
      "The RPC endpoint refused this transaction. Nothing was submitted.",
    );
  });

  test("a refusal leaves the endpoint usable for the retry", async () => {
    const answers = [gatewayAnswer("screening_unavailable", 503)];
    let calls = 0;
    const provider = (nodeUrl: string): RpcProvider =>
      createRpcProvider(nodeUrl, {
        baseFetch: timedRpcFetch(1_000, async (_input, init) => {
          const method = JSON.parse(String(init?.body)).method;
          if (method === "starknet_chainId") {
            return new Response(JSON.stringify({ id: 0, jsonrpc: "2.0", result: CHAIN_ID }));
          }
          calls += 1;
          const answer = answers.shift();
          return answer
            ? new Response(answer.body, { status: answer.status })
            : new Response(JSON.stringify({ id: 1, jsonrpc: "2.0", result: "0x7" }));
        }),
      });
    const send = (): Promise<unknown> =>
      withRpcWrite(
        [NODE_URL],
        CHAIN_ID,
        (selected) => fetchThroughChannel(selected, "starknet_addInvokeTransaction"),
        provider,
      ).catch((error: unknown) => error);

    expect(await send()).toBeInstanceOf(RpcGatewayRefusalError);
    expect(await send()).toBe("0x7");
    expect(calls).toBe(2);
  });
});

describe("anything short of a gateway's coded refusal stays outcome-unknown", () => {
  beforeEach(() => resetRpcEndpointCooldownsForTests());

  const ambiguous: readonly Answer[] = [
    gatewayAnswer("transaction_rejected", 502),
    gatewayAnswer("address_not_allowed", 504),
    gatewayAnswer("upstream_unavailable", 503),
    gatewayAnswer("screening_denied", 500),
    gatewayAnswer("screening_pending", 200),
    { body: '{"error":"Address Not Allowed"}', status: 403 },
    { body: '{"error":"address_not_allowed","detail":"x"}', status: 403 },
    { body: '{"jsonrpc":"2.0","id":1,"error":"address_not_allowed"}', status: 403 },
    { body: "address_not_allowed", status: 403 },
    { body: "<html>Forbidden</html>", status: 403 },
    { body: "", status: 400 },
    { body: `{"error":"${"a".repeat(300)}"}`, status: 400 },
  ];

  test("a 5xx, a 2xx, or a body that is not an exact gateway code", async () => {
    for (const answer of ambiguous) {
      resetRpcEndpointCooldownsForTests();
      const rejection = await broadcastFailure(answer);
      expect(rejection).toBeInstanceOf(IndeterminateRpcWriteError);
      expect((rejection as Error).message).toBe(INDETERMINATE_RPC_WRITE_MESSAGE);
    }
  });

  test("a timeout on a broadcast stays outcome-unknown", async () => {
    const hanging = (nodeUrl: string): RpcProvider =>
      createRpcProvider(nodeUrl, {
        baseFetch: timedRpcFetch(20, async (_input, init) => {
          const method = JSON.parse(String(init?.body)).method;
          if (method === "starknet_chainId") {
            return new Response(JSON.stringify({ id: 0, jsonrpc: "2.0", result: CHAIN_ID }));
          }
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          });
        }),
      });
    const rejection = await withRpcWrite(
      [NODE_URL],
      CHAIN_ID,
      (selected) => fetchThroughChannel(selected, "starknet_addInvokeTransaction"),
      hanging,
    ).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(IndeterminateRpcWriteError);
  });

  test("a read keeps its failover rule for the same gateway body", async () => {
    const outcome = await transportOutcome(
      gatewayAnswer("address_not_allowed", 403),
      "starknet_getNonce",
    );
    expect(outcome).toBeInstanceOf(RpcRefusedError);
  });
});
