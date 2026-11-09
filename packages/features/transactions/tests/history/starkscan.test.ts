/**
 * Starkscan transport and parser boundary checks using representative payloads.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  explorerDiagnosticsSnapshot,
  rpcDiagnosticsSnapshot,
  setReliabilityDiagnosticsEnabled,
} from "@bramble/starknet/rpc-diagnostics";
import { createStarkscanClient, StarkscanError } from "@bramble/transactions/starkscan";

const ACCOUNT = "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";
const TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const jsonResponse = (value: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });

afterEach(() => setReliabilityDiagnosticsEnabled(false));

describe("Starkscan client boundary", () => {
  test("normalizes an adversarial trailing-slash run before requesting", async () => {
    setReliabilityDiagnosticsEnabled(true);
    let currentTime = 0;
    let requested = "";
    const client = createStarkscanClient({
      baseUrl: `https://api.starkscan.test/v1${"/".repeat(8_192)}`,
      async http(url) {
        currentTime = 12;
        requested = url;
        return jsonResponse({
          address: ACCOUNT,
          totalActivityCount: 0,
          latestActivityBlock: null,
          activityCountExact: true,
          classHash: null,
          isAccount: true,
          createdOnIso: null,
          deployedAtTxHash: null,
          deployedByAddress: null,
        });
      },
      now: () => currentTime,
    });

    await client.getAddress("SN_MAIN", ACCOUNT);
    expect(requested).toBe(`https://api.starkscan.test/v1/SN_MAIN/address/${ACCOUNT}`);
    expect(explorerDiagnosticsSnapshot()).toEqual([
      { count: 1, latencyMs: 12, outcome: "ok", service: "starkscan" },
    ]);
    expect(rpcDiagnosticsSnapshot()).toEqual([]);
  });

  test("builds authenticated routes and parses a token balance", async () => {
    const requests: Array<{ init: RequestInit; url: string }> = [];
    const client = createStarkscanClient({
      apiKey: "test-key",
      baseUrl: "https://api.starkscan.test/v1",
      async http(url, init) {
        requests.push({ init, url });
        return jsonResponse({
          balanceRaw: "1023561579571385199213",
          blockTag: "latest",
          chainId: "SN_MAIN",
          ownerAddress: ACCOUNT,
          tokenAddress: TOKEN,
        });
      },
    });

    const balance = await client.getTokenBalance("SN_MAIN", TOKEN, ACCOUNT);
    expect(balance.balanceRaw).toBe("1023561579571385199213");
    expect(requests[0]?.url).toBe(
      `https://api.starkscan.test/v1/SN_MAIN/token/${TOKEN}/balance-of/${ACCOUNT}?block_tag=latest`,
    );
    expect(new Headers(requests[0]?.init.headers).get("X-Starkscan-Api-Key")).toBe("test-key");
  });

  test("parses transfer metadata without trusting extra response fields", async () => {
    const client = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      async http() {
        return jsonResponse({
          items: [
            {
              blockNumber: 12_237_588,
              timestampIso: "2026-07-24T11:29:01.000Z",
              txIndex: 2,
              logIndex: 1,
              transferIndex: 0,
              txHash: "0x40f454",
              tokenAddress: TOKEN,
              fromAddress: ACCOUNT,
              toAddress: "0x1176",
              amount: "47053608819441904",
              rawValue: "47053608819441904",
              tokenId: null,
              standard: "erc20",
              tokenSymbol: "STRK",
              tokenName: "Starknet Token",
              tokenDecimals: 18,
              sourceTier: "finalized",
              actionContext: null,
              futureField: "ignored",
            },
          ],
          nextCursor: "opaque",
        });
      },
    });

    const page = await client.getAddressTransfers("SN_MAIN", ACCOUNT, { limit: 1 });
    expect(page.items[0]).toMatchObject({
      amount: "47053608819441904",
      standard: "erc20",
      tokenSymbol: "STRK",
    });
    expect(page.nextCursor).toBe("opaque");
  });

  test("exposes the remaining validated wallet and chain read routes", async () => {
    const requests: string[] = [];
    const event = {
      blockNumber: 12,
      timestampIso: "2026-07-24T11:29:01.000Z",
      txHash: "0x40f454",
      txIndex: 2,
      logIndex: 1,
      address: TOKEN,
      keys: ["0x1"],
      data: ["0x2"],
      decodingStatus: "decoded",
      eventName: "Transfer",
      sourceTier: "finalized",
    };
    const client = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1/",
      async http(url) {
        requests.push(url);
        if (url.includes("/transactions?")) {
          return jsonResponse({
            items: [
              {
                blockNumber: 12,
                timestampIso: "2026-07-24T11:29:01.000Z",
                txIndex: 2,
                txHash: "0x40f454",
                kinds: ["invoke"],
                counterparty: ACCOUNT,
                txType: "INVOKE",
                executionStatus: "SUCCEEDED",
                finalityStatus: "ACCEPTED_ON_L2",
                transferCount: 1,
                operationKind: "swap",
                operationLabel: "Token swap",
              },
            ],
            nextCursor: null,
          });
        }
        if (url.includes("/activity?")) {
          return jsonResponse({
            items: [
              {
                blockNumber: 12,
                timestampIso: "2026-07-24T11:29:01.000Z",
                txIndex: 2,
                logIndex: 1,
                transferIndex: 0,
                txHash: "0x40f454",
                kind: "token_out",
                counterparty: ACCOUNT,
                tokenAddress: TOKEN,
                amount: "2",
                tokenId: null,
              },
            ],
            nextCursor: null,
          });
        }
        if (url.includes("/balance-of/")) {
          return jsonResponse({
            chainId: "SN_MAIN",
            tokenAddress: TOKEN,
            ownerAddress: ACCOUNT,
            blockTag: "latest",
            balanceRaw: "2",
          });
        }
        if (url.includes("/contract/") && url.includes("/events?")) {
          return jsonResponse({ items: [event], nextCursor: null });
        }
        if (url.includes("/contract/")) {
          return jsonResponse({
            chainId: "SN_MAIN",
            address: TOKEN,
            classHash: "0x1",
            deployedAtBlock: 10,
            deployedAtTx: "0x2",
            createdOnIso: "2026-07-24T11:00:00.000Z",
            deployedByAddress: ACCOUNT,
            isAccount: false,
            isToken: true,
            tokenKind: "erc20",
            alias: "STRK",
            metadataCompleteness: true,
            source: "indexed",
          });
        }
        if (url.includes("/blocks?")) {
          return jsonResponse({
            items: [
              {
                blockNumber: 12,
                blockHash: "0x12",
                parentHash: "0x11",
                timestampIso: "2026-07-24T11:29:01.000Z",
                txCount: 3,
                finalityStatus: "ACCEPTED_ON_L2",
              },
            ],
            nextCursor: null,
          });
        }
        if (url.includes("/events?")) {
          return jsonResponse({ items: [{ ...event, sourceTier: null }], nextCursor: null });
        }
        return jsonResponse({
          address: ACCOUNT,
          totalActivityCount: 3,
          latestActivityBlock: 12,
          activityCountExact: true,
          classHash: "0x1",
          isAccount: true,
          createdOnIso: "2026-07-24T11:00:00.000Z",
          deployedAtTxHash: "0x2",
          deployedByAddress: ACCOUNT,
        });
      },
    });

    const [address, transactions, activity, balance, contract, contractEvents, blocks, events] =
      await Promise.all([
        client.getAddress("SN_MAIN", ACCOUNT),
        client.getAddressTransactions("SN_MAIN", ACCOUNT, { cursor: "next", limit: 2 }),
        client.getAddressActivity("SN_MAIN", ACCOUNT),
        client.getTokenBalance("SN_MAIN", TOKEN, ACCOUNT),
        client.getContract("SN_MAIN", TOKEN),
        client.getContractEvents("SN_MAIN", TOKEN),
        client.getBlocks("SN_MAIN", { limit: 1 }),
        client.getEvents("SN_MAIN", { limit: 1 }),
      ]);

    expect(address.totalActivityCount).toBe(3);
    expect(transactions.items[0]?.operationLabel).toBe("Token swap");
    expect(activity.items[0]?.kind).toBe("token_out");
    expect(balance.balanceRaw).toBe("2");
    expect(contract.tokenKind).toBe("erc20");
    expect(contractEvents.items[0]?.eventName).toBe("Transfer");
    expect(blocks.items[0]?.txCount).toBe(3);
    expect(events.items[0]?.sourceTier).toBeNull();
    expect(requests.some((url) => url.endsWith("transactions?limit=2&cursor=next"))).toBe(true);
  });

  test("rejects malformed data and returns bounded structured HTTP errors", async () => {
    const malformed = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      http: async () =>
        jsonResponse({
          address: ACCOUNT,
          totalActivityCount: -1,
          latestActivityBlock: null,
          activityCountExact: true,
          classHash: null,
          isAccount: true,
          createdOnIso: null,
          deployedAtTxHash: null,
          deployedByAddress: null,
        }),
    });
    await expect(malformed.getAddress("SN_MAIN", ACCOUNT)).rejects.toThrow(
      "Invalid Starkscan response",
    );

    const denied = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      http: async () =>
        jsonResponse(
          { code: "unauthorized", message: "API key required", requestId: "req-1" },
          { status: 401, headers: { "retry-after": "5" } },
        ),
    });
    try {
      await denied.getAddress("SN_MAIN", ACCOUNT);
      throw new Error("Expected Starkscan request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(StarkscanError);
      expect(error).toMatchObject({
        status: 401,
        code: "unauthorized",
        requestId: "req-1",
        retryAfter: "5",
      });
    }
  });

  test("honors explorer Retry-After without repeating the HTTP request", async () => {
    let currentTime = 0;
    let wallClock = Date.parse("2026-08-25T10:00:00.000Z");
    let requests = 0;
    const client = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      async http() {
        requests += 1;
        if (requests === 1) {
          return jsonResponse(
            { message: "Too many requests" },
            {
              headers: { "retry-after": "Tue, 25 Aug 2026 10:01:00 GMT" },
              status: 429,
            },
          );
        }
        return jsonResponse({
          address: ACCOUNT,
          totalActivityCount: 0,
          latestActivityBlock: null,
          activityCountExact: true,
          classHash: null,
          isAccount: true,
          createdOnIso: null,
          deployedAtTxHash: null,
          deployedByAddress: null,
        });
      },
      now: () => currentTime,
      wallClock: () => wallClock,
    });

    await expect(client.getAddress("SN_MAIN", ACCOUNT)).rejects.toMatchObject({ status: 429 });
    await expect(client.getAddress("SN_MAIN", ACCOUNT)).rejects.toMatchObject({ status: 429 });
    expect(requests).toBe(1);

    currentTime += 60_000;
    wallClock += 60_000;
    await expect(client.getAddress("SN_MAIN", ACCOUNT)).resolves.toMatchObject({
      address: ACCOUNT,
    });
    expect(requests).toBe(2);
  });

  test("keeps the longest explorer cooldown across concurrent requests", async () => {
    let currentTime = 0;
    let requests = 0;
    let resolveFailure = (_response: Response): void => undefined;
    let resolveSuccess = (_response: Response): void => undefined;
    const address = () =>
      jsonResponse({
        address: ACCOUNT,
        totalActivityCount: 0,
        latestActivityBlock: null,
        activityCountExact: true,
        classHash: null,
        isAccount: true,
        createdOnIso: null,
        deployedAtTxHash: null,
        deployedByAddress: null,
      });
    const client = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      async http() {
        requests += 1;
        if (requests === 1) {
          return jsonResponse(
            { message: "Too many requests" },
            { headers: { "retry-after": "60" }, status: 429 },
          );
        }
        if (requests === 2) {
          return new Promise<Response>((resolve) => {
            resolveFailure = resolve;
          });
        }
        if (requests === 3) {
          return new Promise<Response>((resolve) => {
            resolveSuccess = resolve;
          });
        }
        return address();
      },
      now: () => currentTime,
    });

    const limited = client.getAddress("SN_MAIN", ACCOUNT);
    const failing = client.getAddress("SN_MAIN", ACCOUNT);
    const succeeding = client.getAddress("SN_MAIN", ACCOUNT);
    await expect(limited).rejects.toMatchObject({ status: 429 });
    resolveFailure(jsonResponse({ message: "Unavailable" }, { status: 503 }));
    await expect(failing).rejects.toMatchObject({ status: 503 });
    resolveSuccess(address());
    await expect(succeeding).resolves.toMatchObject({ address: ACCOUNT });

    currentTime += 30_000;
    await expect(client.getAddress("SN_MAIN", ACCOUNT)).rejects.toMatchObject({ status: 429 });
    expect(requests).toBe(3);

    currentTime += 30_000;
    await expect(client.getAddress("SN_MAIN", ACCOUNT)).resolves.toMatchObject({
      address: ACCOUNT,
    });
    expect(requests).toBe(4);
  });

  test("records an explorer timeout in the explorer lane", async () => {
    setReliabilityDiagnosticsEnabled(true);
    const client = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      http: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
      now: () => 0,
      timeoutMs: 5,
    });

    await expect(client.getAddress("SN_MAIN", ACCOUNT)).rejects.toThrow("timed out");
    expect(explorerDiagnosticsSnapshot()).toEqual([
      { count: 1, latencyMs: 0, outcome: "timeout", service: "starkscan" },
    ]);
    expect(rpcDiagnosticsSnapshot()).toEqual([]);
  });

  test("rejects invalid path inputs before transport", async () => {
    let called = false;
    const client = createStarkscanClient({
      baseUrl: "https://starkscan.test/v1",
      http: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    expect(() => client.getAddress("SN_MAIN", "not-an-address")).toThrow(
      "Invalid Starkscan address",
    );
    expect(() => client.getBlocks("SN_MAIN", { limit: 201 })).toThrow(
      "Invalid Starkscan page limit",
    );
    expect(() => client.getEvents("SN_MAIN", { cursor: "" })).toThrow("Invalid Starkscan cursor");
    expect(() => client.getTokenBalance("SN_MAIN", TOKEN, ACCOUNT, "")).toThrow(
      "Invalid Starkscan block tag",
    );
    expect(called).toBe(false);
  });
});
