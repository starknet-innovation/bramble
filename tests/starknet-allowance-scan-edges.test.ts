/**
 * External-allowance scan edge branches: the per-token spender cap
 * (MAX_SPENDERS_PER_TOKEN), a transport error aborting the whole scan, and the
 * production scanExternalAllowances provider adapter driven through a real
 * RpcProvider against a local JSON-RPC stub. Complements
 * starknet-allowance-scan.test.ts.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { APPROVAL_EVENT_KEY } from "../src/starknet/allowance-discovery";
import type { AllowanceEvent, AllowanceRpc } from "../src/starknet/allowance-scan";
import { collectExternalAllowances, scanExternalAllowances } from "../src/starknet/allowance-scan";

const OWNER = "0x1234567890abcdef";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = "0x05abcdef";
const canonical = (value: string): string => `0x${BigInt(value).toString(16)}`;

const ozEvent = (owner: string, spender: string): AllowanceEvent => ({
  data: ["0x64", "0x0"],
  keys: [APPROVAL_EVENT_KEY, owner, spender],
});

describe("collectExternalAllowances edges", () => {
  test("stops discovering spenders at the per-token cap of 50", async () => {
    // 60 distinct approved spenders in one page; discovery must cap at 50.
    const spenders = Array.from({ length: 60 }, (_, index) => `0x${(0x1000 + index).toString(16)}`);
    const rpc: AllowanceRpc = {
      async callContract() {
        // Every spender has a non-zero live allowance.
        return ["0x64", "0x0"];
      },
      async getEvents() {
        return { events: spenders.map((spender) => ozEvent(OWNER, spender)) };
      },
    };

    const found = await collectExternalAllowances(rpc, { owner: OWNER, tokens: [TOKEN] });
    expect(found).toHaveLength(50);
  });

  test("propagates a transport error rather than skipping the token", async () => {
    const rpc: AllowanceRpc = {
      async callContract() {
        return ["0x64", "0x0"];
      },
      async getEvents() {
        // No baseError code -> classified as transport-level -> must abort.
        throw new Error("fetch failed");
      },
    };

    await expect(collectExternalAllowances(rpc, { owner: OWNER, tokens: [TOKEN] })).rejects.toThrow(
      "fetch failed",
    );
  });
});

// Local JSON-RPC stub so scanExternalAllowances runs its real RpcProvider
// adapter (getEvents + callContract) without a network.
const startRpc = () => {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { id: number; method: string };
      const reply = (result: unknown) => Response.json({ id: body.id, jsonrpc: "2.0", result });
      if (body.method === "starknet_getEvents") {
        return reply({ events: [ozEvent(canonical(OWNER), canonical(SPENDER))] });
      }
      if (body.method === "starknet_call") {
        return reply(["0x3e8", "0x0"]);
      }
      if (body.method === "starknet_specVersion") {
        return reply("0.8.1");
      }
      return reply("0x0");
    },
  });
  return { server, url: `http://127.0.0.1:${server.port}` };
};

const servers: { stop: (force?: boolean) => void }[] = [];
afterAll(() => {
  for (const server of servers) {
    server.stop(true);
  }
});

describe("scanExternalAllowances", () => {
  test("returns an empty list without touching RPC when no tokens are tracked", async () => {
    expect(
      await scanExternalAllowances({ owner: OWNER, rpcUrls: ["http://127.0.0.1:9"], tokens: [] }),
    ).toEqual([]);
  });

  test("discovers a live allowance through the real provider adapter", async () => {
    const { server, url } = startRpc();
    servers.push(server);

    const found = await scanExternalAllowances({ owner: OWNER, rpcUrls: [url], tokens: [TOKEN] });
    expect(found).toEqual([
      { amount: "1000", spender: canonical(SPENDER), token: canonical(TOKEN) },
    ]);
  });
});
