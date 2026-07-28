/**
 * Starkscan transport and parser boundary checks using representative payloads.
 */
import { describe, expect, test } from "bun:test";
import { createStarkscanClient, StarkscanError } from "../../src/starknet/starkscan";

const ACCOUNT = "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";
const TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const jsonResponse = (value: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });

describe("Starkscan client boundary", () => {
  test("builds authenticated routes and parses complete token holdings", async () => {
    const requests: Array<{ init: RequestInit; url: string }> = [];
    const client = createStarkscanClient({
      apiKey: "test-key",
      baseUrl: "https://api.starkscan.test/v1",
      async http(url, init) {
        requests.push({ init, url });
        return jsonResponse({
          chainId: "SN_MAIN",
          ownerAddress: ACCOUNT,
          items: [
            {
              tokenAddress: TOKEN,
              normalizedTokenAddress: TOKEN,
              indexedBalanceRaw: "1023561579571385199213",
              symbol: "STRK",
              name: "Starknet Token",
              decimals: 18,
            },
          ],
          exact: true,
          truncated: false,
          completeness: {
            exact: true,
            truncated: false,
            complete: true,
            reasonCode: "complete",
            reason: "Complete snapshot.",
            lagBlocks: 0,
            capped: false,
            cap: null,
          },
        });
      },
    });

    const holdings = await client.getTokenHoldings("SN_MAIN", ACCOUNT, { limit: 25 });
    expect(holdings.items[0]?.symbol).toBe("STRK");
    expect(holdings.completeness.complete).toBe(true);
    expect(requests[0]?.url).toBe(
      `https://api.starkscan.test/v1/SN_MAIN/address/${ACCOUNT}/token-holdings?limit=25`,
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
