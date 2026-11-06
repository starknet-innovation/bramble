/**
 * A node or gateway that answers a read with a body that is not JSON (a plain
 * "service unavailable" line, an HTML error page, nothing at all) never gave
 * the wallet a JSON-RPC answer. The transport calls that a refusal so the read
 * fails over and the reader gets the refusal sentence, not starknet.js's raw
 * `response.json()` parse error (issue 857). A broadcast keeps its
 * outcome-unknown result: a proxy page can follow a node that accepted it.
 */
import { beforeEach, describe, expect, test } from "bun:test";
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
const NODE_URL = "https://non-json-refusal.example";
const UNAVAILABLE = "starknet service unavailable";
const HTML_PAGE = `<!doctype html><html><body>${"Service Unavailable ".repeat(100)}</body></html>`;
// Too large to parse twice, and opening like JSON.
const BRACKETED = `[upstream unavailable] ${"retry later ".repeat(100)}`;
const BRACED = `{${"upstream unavailable ".repeat(100)}`;

type Answer = () => Response;

const NON_JSON: readonly Answer[] = [
  () => new Response(UNAVAILABLE, { status: 503 }),
  () => new Response(UNAVAILABLE, { status: 200 }),
  () => new Response(HTML_PAGE, { headers: { "content-type": "text/html" }, status: 502 }),
  () => new Response(BRACKETED, { status: 503 }),
  () => new Response(BRACED, { status: 503 }),
  () => new Response("", { status: 504 }),
  () => new Response(null, { status: 503 }),
];

const rpcBody = (method: string): string => JSON.stringify({ id: 1, jsonrpc: "2.0", method });

const transportOutcome = (reply: Answer, method: string): Promise<unknown> =>
  timedRpcFetch(1_000, async () => reply())(NODE_URL, {
    body: rpcBody(method),
    method: "POST",
  }).catch((error: unknown) => error);

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

describe("a read answered with a body that is not JSON is a refusal", () => {
  beforeEach(() => resetRpcEndpointCooldownsForTests());

  test("the issue repro: a plain-text 503 reaches the reader as the refusal sentence", async () => {
    const urls = ["https://first-unavailable.example", "https://second-unavailable.example"];
    const seen: string[] = [];
    const rejection = await withRpcFallback(
      urls,
      async (provider) => {
        seen.push(provider.channel.nodeUrl);
        return fetchThroughChannel(provider, "starknet_getClassHashAt");
      },
      scripted(() => new Response(UNAVAILABLE, { status: 503 })),
    ).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(RpcRefusedError);
    expect((rejection as Error).message).toBe(RPC_REFUSED_MESSAGE);
    expect((rejection as Error).message).not.toContain("JSON");
    expect(seen).toEqual(urls);
  });

  test("the transport refuses every non-JSON shape on a read, keeping Retry-After", async () => {
    for (const reply of NON_JSON) {
      const outcome = await transportOutcome(reply, "starknet_getNonce");
      expect(outcome).toBeInstanceOf(RpcRefusedError);
      expect((outcome as Error).message).toBe(RPC_REFUSED_MESSAGE);
    }
    const throttled = await transportOutcome(
      () => new Response(UNAVAILABLE, { headers: { "retry-after": "90" }, status: 503 }),
      "starknet_getNonce",
    );
    expect((throttled as RpcRefusedError).retryAfter).toBe("90");
  });

  test("a JSON-RPC answer on a non-2xx status still reaches starknet.js", async () => {
    const large = JSON.stringify({ id: 1, jsonrpc: "2.0", result: "0x1".repeat(1_000) });
    const answers = [
      {
        body: '{"jsonrpc":"2.0","id":1,"error":{"code":20,"message":"Contract not found"}}',
        status: 500,
      },
      { body: `  \n${large}\n`, status: 200 },
      { body: `[${large}]`, status: 200 },
      { body: JSON.stringify([{ id: 1, jsonrpc: "2.0", result: "0x7" }]), status: 200 },
    ];
    for (const { body, status } of answers) {
      const outcome = await transportOutcome(
        () => new Response(body, { status }),
        "starknet_getNonce",
      );
      expect(outcome).toBeInstanceOf(Response);
      expect(await (outcome as Response).text()).toBe(body);
    }
  });
});

describe("a broadcast answered with a body that is not JSON stays outcome-unknown", () => {
  beforeEach(() => resetRpcEndpointCooldownsForTests());

  test("the transport passes the body through, and the write reads as status unknown", async () => {
    for (const reply of NON_JSON) {
      const outcome = await transportOutcome(reply, "starknet_addInvokeTransaction");
      expect(outcome).toBeInstanceOf(Response);

      resetRpcEndpointCooldownsForTests();
      const rejection = await withRpcWrite(
        [NODE_URL],
        CHAIN_ID,
        (selected) => fetchThroughChannel(selected, "starknet_addInvokeTransaction"),
        scripted(reply),
      ).catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(IndeterminateRpcWriteError);
      expect((rejection as Error).message).toBe(INDETERMINATE_RPC_WRITE_MESSAGE);
    }
  });
});
