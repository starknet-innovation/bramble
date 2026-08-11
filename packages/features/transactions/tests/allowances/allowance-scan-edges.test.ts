/**
 * External-allowance scan edge branches: the per-token spender cap
 * (MAX_SPENDERS_PER_TOKEN), a transport error aborting the whole scan, and the
 * production scanExternalAllowances provider adapter driven through a real
 * RpcProvider against a local JSON-RPC stub. Complements
 * starknet-allowance-scan.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { APPROVAL_EVENT_KEY } from "@mc-wallet/transactions/allowance-discovery";
import type { AllowanceEvent, AllowanceRpc } from "@mc-wallet/transactions/allowance-scan";
import {
  collectExternalAllowances,
  scanExternalAllowances,
} from "@mc-wallet/transactions/allowance-scan";
import type { RpcProvider } from "starknet";

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

  test("accumulates per token in token order, skipping a token that yields no spenders", async () => {
    // Two tracked tokens through the extracted per-token collection step: the
    // first has one approved spender with a live allowance, the second emits no
    // Approval events. The result must carry only the first token's allowance,
    // proving the per-token accumulation drops empty tokens without aborting.
    const TOKEN_WITHOUT_SPENDERS = "0x0511a2b3";
    const rpc: AllowanceRpc = {
      async callContract() {
        return ["0x64", "0x0"];
      },
      async getEvents(filter) {
        return BigInt(filter.address) === BigInt(TOKEN)
          ? { events: [ozEvent(OWNER, SPENDER)] }
          : { events: [] };
      },
    };

    const found = await collectExternalAllowances(rpc, {
      owner: OWNER,
      tokens: [TOKEN, TOKEN_WITHOUT_SPENDERS],
    });
    expect(found).toEqual([
      { amount: "100", spender: canonical(SPENDER), token: canonical(TOKEN) },
    ]);
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

const rpcProvider = {
  async callContract() {
    return ["0x3e8", "0x0"];
  },
  async getEvents() {
    return { events: [ozEvent(canonical(OWNER), canonical(SPENDER))] };
  },
} as unknown as RpcProvider;

describe("scanExternalAllowances", () => {
  test("returns an empty list without touching RPC when no tokens are tracked", async () => {
    expect(
      await scanExternalAllowances({ owner: OWNER, rpcUrls: ["http://127.0.0.1:9"], tokens: [] }),
    ).toEqual([]);
  });

  test("discovers a live allowance through the real provider adapter", async () => {
    const found = await scanExternalAllowances(
      { owner: OWNER, rpcUrls: ["https://rpc.example"], tokens: [TOKEN] },
      () => rpcProvider,
    );
    expect(found).toEqual([
      { amount: "1000", spender: canonical(SPENDER), token: canonical(TOKEN) },
    ]);
  });
});
