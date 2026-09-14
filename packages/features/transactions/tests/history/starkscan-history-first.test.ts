/**
 * Transaction history is explorer-first: the indexed gateway answers when the
 * user's per-network explorer preference permits, and the RPC transfer scan is
 * the keyless fallback. These cases pin the ordering as a sequence (a refactor
 * that raced the lanes or warmed the RPC scan first would reorder the trace),
 * the disclosure gate (a refused lane never learns the address), and honest
 * failure (the feed is unavailable only when neither permitted lane answered).
 */
import { describe, expect, test } from "bun:test";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { createStarkscanClient, type StarkscanHttp } from "@bramble/transactions/starkscan";
import { createExplorerFirstHistory } from "@bramble/transactions/starkscan-wallet";
import { TRANSFER_EVENT_KEY } from "@bramble/transactions/tx-history";
import type { ExplorerLanePreferences, TokenConfig } from "@bramble/wallet-model/preferences";
import type { RpcProvider } from "starknet";

const ACCOUNT = "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";
const OTHER = "0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8";
const TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const MY_NODE = "https://my-node.example/rpc";

const strk: TokenConfig = {
  address: TOKEN,
  decimals: 18,
  id: `SN_MAIN:STRK:${TOKEN}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};

const historyInput = {
  account: ACCOUNT,
  accountId: `SN_MAIN:${ACCOUNT}`,
  networkId: "SN_MAIN",
  rpcUrls: [MY_NODE],
  tokens: [strk],
} as const;

// The explorer's row and the RPC's event name different transactions, so which
// lane produced the feed is readable from the hash alone.
const EXPLORER_HASH = "0x40f454";
const RPC_HASH = "0xb22";

const transfersBody = {
  items: [
    {
      actionContext: null,
      amount: "47053608819441904",
      blockNumber: 12_237_588,
      fromAddress: ACCOUNT,
      logIndex: 1,
      rawValue: "47053608819441904",
      sourceTier: "finalized",
      standard: "erc20",
      timestampIso: "2026-07-24T11:29:01.000Z",
      toAddress: OTHER,
      tokenAddress: TOKEN,
      tokenDecimals: 18,
      tokenId: null,
      tokenName: "Starknet Token",
      tokenSymbol: "STRK",
      transferIndex: 0,
      txHash: EXPLORER_HASH,
      txIndex: 2,
    },
  ],
  nextCursor: null,
};

// A gateway that records every request URL and appends to a shared trace, so
// both "was the address disclosed?" and "in what order?" are direct assertions.
const gateway = (trace: string[], respond: () => Response | never) => {
  const urls: string[] = [];
  const http: StarkscanHttp = async (url) => {
    trace.push("gateway");
    urls.push(url);
    return respond();
  };
  return { client: createStarkscanClient({ baseUrl: "https://starkscan.test/v1", http }), urls };
};
const answering = (trace: string[], body: unknown = transfersBody) =>
  gateway(trace, () => new Response(JSON.stringify(body)));
const failing = (trace: string[], status = 503) =>
  gateway(trace, () => new Response("{}", { status }));

const workingRpc = (trace: string[]) =>
  ({
    async getBlockNumber() {
      trace.push("rpc");
      return 500;
    },
    async getBlockWithTxHashes() {
      return { timestamp: 1_700_000_000 } as Awaited<
        ReturnType<RpcProvider["getBlockWithTxHashes"]>
      >;
    },
    async getEvents() {
      return {
        events: [
          {
            block_number: 101,
            data: ["500000000000000000", "0"],
            keys: [TRANSFER_EVENT_KEY, ACCOUNT, OTHER],
            transaction_hash: RPC_HASH,
          },
        ],
      } as Awaited<ReturnType<RpcProvider["getEvents"]>>;
    },
  }) as unknown as RpcProvider;

const failingRpc = (trace: string[]) =>
  ({
    async getBlockNumber() {
      trace.push("rpc");
      throw new Error("node unreachable");
    },
  }) as unknown as RpcProvider;

const permitted: ExplorerLanePreferences = { explorerFallback: {}, rpcOverrides: {} };
const historyWith = (
  client: ReturnType<typeof createStarkscanClient>,
  preferences: () => Promise<ExplorerLanePreferences> = async () => permitted,
) => createExplorerFirstHistory({ client, readPreferences: preferences });

describe("explorer-first transaction history", () => {
  test("serves history from the explorer without touching the RPC", async () => {
    const trace: string[] = [];
    const explorer = answering(trace);
    const entries = await historyWith(explorer.client)(historyInput, () => workingRpc(trace));

    expect(entries.map((entry) => entry.hash)).toEqual([EXPLORER_HASH]);
    expect(trace).toEqual(["gateway"]);
    expect(explorer.urls).toHaveLength(1);
    expect(explorer.urls[0]).toContain(`address=${ACCOUNT}`);
  });

  test("an empty explorer page is the answer, not a reason to scan", async () => {
    const trace: string[] = [];
    const explorer = answering(trace, { items: [], nextCursor: null });
    const entries = await historyWith(explorer.client)(historyInput, () => workingRpc(trace));

    expect(entries).toEqual([]);
    expect(trace).toEqual(["gateway"]);
  });

  test("falls back to the RPC scan strictly after an explorer failure", async () => {
    resetRpcEndpointCooldownsForTests();
    const trace: string[] = [];
    const explorer = failing(trace);
    const entries = await historyWith(explorer.client)(historyInput, () => workingRpc(trace));

    expect(entries.map((entry) => entry.hash)).toEqual([RPC_HASH]);
    expect(trace).toEqual(["gateway", "rpc"]);
  });

  test("falls back when the explorer answers with a malformed body", async () => {
    resetRpcEndpointCooldownsForTests();
    const trace: string[] = [];
    const explorer = answering(trace, { items: "not-a-page" });
    const entries = await historyWith(explorer.client)(historyInput, () => workingRpc(trace));

    expect(entries.map((entry) => entry.hash)).toEqual([RPC_HASH]);
    expect(trace).toEqual(["gateway", "rpc"]);
  });

  test("reports the RPC failure when neither lane answers", async () => {
    resetRpcEndpointCooldownsForTests();
    const trace: string[] = [];
    const explorer = failing(trace);
    await expect(
      historyWith(explorer.client)(historyInput, () => failingRpc(trace)),
    ).rejects.toThrow("node unreachable");
    expect(trace).toEqual(["gateway", "rpc"]);
  });

  test("a configured rpcOverride keeps the address off the explorer", async () => {
    resetRpcEndpointCooldownsForTests();
    const trace: string[] = [];
    const explorer = answering(trace);
    const entries = await historyWith(explorer.client, async () => ({
      explorerFallback: {},
      rpcOverrides: { SN_MAIN: MY_NODE },
    }))(historyInput, () => workingRpc(trace));

    expect(entries.map((entry) => entry.hash)).toEqual([RPC_HASH]);
    expect(trace).toEqual(["rpc"]);
    expect(explorer.urls).toEqual([]);
  });

  test("an explicit opt-out is never disclosed, and the RPC failure surfaces", async () => {
    resetRpcEndpointCooldownsForTests();
    const trace: string[] = [];
    const explorer = answering(trace);
    await expect(
      historyWith(explorer.client, async () => ({
        explorerFallback: { SN_MAIN: false },
        rpcOverrides: {},
      }))(historyInput, () => failingRpc(trace)),
    ).rejects.toThrow("node unreachable");
    expect(trace).toEqual(["rpc"]);
    expect(explorer.urls).toEqual([]);
  });

  test("an override user who opts back in gets the explorer first again", async () => {
    const trace: string[] = [];
    const explorer = answering(trace);
    const entries = await historyWith(explorer.client, async () => ({
      explorerFallback: { SN_MAIN: true },
      rpcOverrides: { SN_MAIN: MY_NODE },
    }))(historyInput, () => workingRpc(trace));

    expect(entries.map((entry) => entry.hash)).toEqual([EXPLORER_HASH]);
    expect(trace).toEqual(["gateway"]);
  });

  test("a preferences read that throws fails closed to the RPC scan", async () => {
    resetRpcEndpointCooldownsForTests();
    const trace: string[] = [];
    const explorer = answering(trace);
    const entries = await historyWith(explorer.client, async () => {
      throw new Error("preferences unavailable");
    })(historyInput, () => workingRpc(trace));

    expect(entries.map((entry) => entry.hash)).toEqual([RPC_HASH]);
    expect(trace).toEqual(["rpc"]);
    expect(explorer.urls).toEqual([]);
  });

  test("devnet never reaches the explorer", async () => {
    resetRpcEndpointCooldownsForTests();
    const trace: string[] = [];
    const explorer = answering(trace);
    const entries = await historyWith(explorer.client)(
      {
        ...historyInput,
        accountId: `SN_DEVNET:${ACCOUNT}`,
        networkId: "SN_DEVNET",
        tokens: [{ ...strk, id: `SN_DEVNET:STRK:${TOKEN}`, networkId: "SN_DEVNET" }],
      },
      () => workingRpc(trace),
    );

    expect(entries.map((entry) => entry.hash)).toEqual([RPC_HASH]);
    expect(trace).toEqual(["rpc"]);
    expect(explorer.urls).toEqual([]);
  });

  test("selects the per-network configured explorer client", async () => {
    const trace: string[] = [];
    const bundled = answering(trace);
    const configured = answering(trace);
    const selections: string[] = [];
    const entries = await createExplorerFirstHistory({
      client: bundled.client,
      clientFor: (networkId, current) => {
        selections.push(`${networkId}:${current.explorerApiUrls?.[networkId]}`);
        return configured.client;
      },
      readPreferences: async () => ({
        explorerApiUrls: { SN_MAIN: "https://explorer.example/v1" },
        explorerFallback: {},
        rpcOverrides: {},
      }),
    })(historyInput, () => workingRpc(trace));

    expect(entries.map((entry) => entry.hash)).toEqual([EXPLORER_HASH]);
    expect(selections).toEqual(["SN_MAIN:https://explorer.example/v1"]);
    expect(configured.urls).toHaveLength(1);
    expect(bundled.urls).toEqual([]);
  });
});
