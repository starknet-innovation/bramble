/**
 * Live-API smoke test for the trade terminal's data layer.
 *
 * WHY: the app's real failures (CORS, 429s, wrong hostnames, changed response
 * shapes) only show up against the LIVE upstreams. The browser can't reach them
 * directly (CORS) and the CI sandbox is network-blocked, so this script is meant
 * to be run ON YOUR OWN MACHINE, where Node/Bun `fetch` has no CORS and full
 * egress. It hits every endpoint the app depends on DIRECTLY (bypassing the Vite
 * dev proxy) and, for each one, feeds the real response into the app's OWN
 * parser/normalizer to prove the shape the code expects still holds.
 *
 * USAGE:
 *   cd apps/terminal
 *   bun run check:api
 *
 * OUTPUT: one PASS/FAIL line per endpoint (HTTP status + latency + a sample of
 * the parsed result), then a summary table. Exit code is non-zero if any
 * REQUIRED endpoint failed (optional endpoints — e.g. the Ekubo fallback — only
 * warn). Each request has its own timeout and its errors are caught, so one dead
 * host never aborts the whole run.
 */
import { CallData, RpcProvider } from "starknet";
import {
  AVNU_DIRECT_BASE,
  AVNU_MARKETS_DIRECT_BASE,
  EKUBO_DIRECT_BASE,
  EXTENDED_REST_DIRECT_BASE,
  EXTENDED_WS_DIRECT_BASE,
  RPC_DIRECT_URLS,
  STARKSCAN_DIRECT_BASE,
} from "../src/data/endpoints";
import {
  parseChainPulse,
  parseStarkscanBalances,
  parseWalletActivity,
} from "../src/data/starkscan";
import { toAvnuRows, toEkuboRows } from "../src/data/useTokens";
import { toAvnuCandles } from "../src/data/useCandles";
import { parseEkuboTokenTrades } from "../src/data/useTokenTrades";
import { parseVesuMarkets, parseVesuPositions } from "../src/data/vesu/parse";
import {
  parseCandles,
  parseFundingHistory,
  parseMarketStatsResponse,
  parseMarkets,
  parseOrderBookResponse,
  parseStreamMessage,
} from "../src/data/extended/parse";
import {
  AVNU_BUILD_PATH,
  buildQuotesUrl,
  parseBuildResponse,
  parseQuoteResponse,
} from "../src/protocols/avnu-swap";
import {
  MAINNET_TOKEN_ADDRESSES,
  VESU_ADDRESSES,
  VESU_API_BASE,
} from "../src/protocols/constants";
import { STARKNET_NETWORKS } from "../src/protocols/support/networks";
import { parseVesuMultiplyExactOutQuote } from "../src/protocols/vesu-multiply";

const REQUEST_TIMEOUT_MS = 15_000;
const SAMPLE_MARKET = "BTC-USD";
const SAMPLE_STARKSCAN_ADDRESS =
  "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";
const EXTENDED_USER_AGENT = "MC-Wallet-Terminal/0.1";

type Outcome = {
  readonly name: string;
  readonly required: boolean;
  readonly ok: boolean;
  readonly status: number | string;
  readonly ms: number;
  readonly detail: string;
};

const results: Outcome[] = [];

const trunc = (value: string, max = 160): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const keysOf = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `array(${value.length})` + (value.length > 0 ? ` first=${trunc(JSON.stringify(value[0]))}` : "");
  }
  if (value !== null && typeof value === "object") {
    return `keys=[${Object.keys(value as Record<string, unknown>).slice(0, 12).join(", ")}]`;
  }
  return String(value);
};

/** Fetches JSON with a hard timeout; returns status + parsed body (or throws). */
const fetchJsonDirect = async (
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has("accept")) {
      headers.set("accept", "application/json");
    }
    const res = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // leave as text so non-JSON error pages still print
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} — ${trunc(typeof body === "string" ? body : JSON.stringify(body))}`);
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Runs one named check. `run` returns { status, detail }; a throw records a FAIL.
 */
const check = async (
  name: string,
  required: boolean,
  run: () => Promise<{ status: number | string; detail: string }>,
): Promise<void> => {
  const started = Date.now();
  try {
    const { status, detail } = await run();
    const ms = Date.now() - started;
    results.push({ name, required, ok: true, status, ms, detail });
    // eslint-disable-next-line no-console
    console.log(`PASS  ${name.padEnd(34)} ${String(status).padEnd(5)} ${`${ms}ms`.padStart(7)}  ${detail}`);
  } catch (cause) {
    const ms = Date.now() - started;
    const message = cause instanceof Error ? cause.message : String(cause);
    const statusMatch = /HTTP (\d{3})/.exec(message);
    results.push({
      name,
      required,
      ok: false,
      status: statusMatch?.[1] ?? "ERR",
      ms,
      detail: trunc(message),
    });
    // eslint-disable-next-line no-console
    console.log(
      `${required ? "FAIL" : "WARN"}  ${name.padEnd(34)} ${(statusMatch?.[1] ?? "ERR").padEnd(5)} ${`${ms}ms`.padStart(7)}  ${trunc(message)}`,
    );
  }
};

/** Opens one public stream and requires a valid Extended envelope. */
const checkExtendedStream = (url: string): Promise<{ status: string; detail: string }> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const HeaderWebSocket = WebSocket as unknown as new (
      socketUrl: string,
      options: { readonly headers: Record<string, string> },
    ) => WebSocket;
    const socket = new HeaderWebSocket(url, {
      headers: { "User-Agent": EXTENDED_USER_AGENT },
    });
    const finish = (result: { status: string; detail: string } | Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };
    const timer = setTimeout(
      () => finish(new Error(`WebSocket timed out after ${REQUEST_TIMEOUT_MS}ms`)),
      REQUEST_TIMEOUT_MS,
    );
    socket.onmessage = (event) => {
      const envelope = parseStreamMessage(event.data);
      if (envelope !== null) {
        finish({
          status: "ws",
          detail: `type=${envelope.type} seq=${envelope.seq ?? "n/a"}`,
        });
      }
    };
    socket.onerror = () => finish(new Error("WebSocket handshake failed"));
    socket.onclose = () => finish(new Error("WebSocket closed before a valid frame"));
  });

const main = async (): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log("Trade Terminal — live API check (direct hosts, no proxy)\n");
  const ETH = MAINNET_TOKEN_ADDRESSES.ETH;

  // ---- Avnu (token universe, primary) ------------------------------------
  await check("AVNU market data", true, async () => {
    const { status, body } = await fetchJsonDirect(`${AVNU_MARKETS_DIRECT_BASE}/v3/tokens`);
    const rows = toAvnuRows(body as never);
    return { status, detail: `${keysOf(body)} -> ${rows.length} TokenRows (first symbol=${rows[0]?.symbol ?? "n/a"})` };
  });

  await check("AVNU multi-token price history", true, async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 86_400_000);
    const params = new URLSearchParams({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      resolution: "1H",
    });
    const { status, body } = await fetchJsonDirect(
      `${AVNU_MARKETS_DIRECT_BASE}/v3/tokens/${MAINNET_TOKEN_ADDRESSES.STRK}/prices/line?${params}`,
    );
    const rows = toAvnuCandles(body as never);
    return {
      status,
      detail: `${rows.length} STRK price intervals (last=${rows.at(-1)?.close ?? "n/a"})`,
    };
  });

  await check("AVNU v3 swap quote/build", true, async () => {
    const takerAddress = "0x1";
    const quoteResponse = await fetchJsonDirect(
      buildQuotesUrl(AVNU_DIRECT_BASE, {
        buyToken: MAINNET_TOKEN_ADDRESSES.STRK,
        sellAmount: "1000000000000000",
        sellToken: ETH,
        takerAddress,
      }),
    );
    const quote = parseQuoteResponse(quoteResponse.body);
    const buildResponse = await fetchJsonDirect(`${AVNU_DIRECT_BASE}/${AVNU_BUILD_PATH}`, {
      body: JSON.stringify({
        includeApprove: false,
        quoteId: quote.quoteId,
        slippage: 0.005,
        takerAddress,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const call = parseBuildResponse(buildResponse.body);
    return {
      status: `${quoteResponse.status}/${buildResponse.status}`,
      detail: `buy=${quote.buyAmount} entrypoint=${call.entrypoint}`,
    };
  });

  // ---- Starkscan (indexed portfolio + chain pulse) -----------------------
  await check("Starkscan token holdings", true, async () => {
    const { status, body } = await fetchJsonDirect(
      `${STARKSCAN_DIRECT_BASE}/address/${SAMPLE_STARKSCAN_ADDRESS}/token-holdings`,
    );
    const balances = parseStarkscanBalances(body, SAMPLE_STARKSCAN_ADDRESS);
    return {
      status,
      detail: `${balances.length} exact holdings (first=${balances[0]?.symbol ?? "n/a"})`,
    };
  });

  await check("Starkscan live chain pulse", true, async () => {
    const [blocks, events, messages] = await Promise.all([
      fetchJsonDirect(`${STARKSCAN_DIRECT_BASE}/blocks?limit=3`),
      fetchJsonDirect(`${STARKSCAN_DIRECT_BASE}/events?limit=20`),
      fetchJsonDirect(`${STARKSCAN_DIRECT_BASE}/messages?limit=3`),
    ]);
    const blockItems =
      blocks.body !== null &&
      typeof blocks.body === "object" &&
      Array.isArray((blocks.body as { readonly items?: unknown }).items)
        ? (blocks.body as { readonly items: readonly unknown[] }).items
        : [];
    const head =
      blockItems[0] !== null && typeof blockItems[0] === "object"
        ? (blockItems[0] as { readonly blockNumber?: unknown }).blockNumber
        : null;
    if (!Number.isSafeInteger(head)) {
      throw new Error("Starkscan returned no indexed head block");
    }
    const transactions = await fetchJsonDirect(
      `${STARKSCAN_DIRECT_BASE}/block/${String(head)}/txs?limit=12`,
    );
    const pulse = parseChainPulse(
      blocks.body,
      transactions.body,
      events.body,
      messages.body,
    );
    return {
      status: `${blocks.status}/${transactions.status}/${events.status}/${messages.status}`,
      detail: `${pulse.blocks.length} blocks, ${pulse.transactions.length} txs, ${pulse.events.length} non-fee events, ${pulse.messages.length} messages`,
    };
  });

  await check("Starkscan wallet activity", true, async () => {
    const { status, body } = await fetchJsonDirect(
      `${STARKSCAN_DIRECT_BASE}/address/${SAMPLE_STARKSCAN_ADDRESS}/transactions?limit=30`,
    );
    const activity = parseWalletActivity(body);
    return {
      status,
      detail: `${activity.length} wallet transactions (latest=${activity[0]?.title ?? "none"})`,
    };
  });

  // ---- Ekubo (token universe, fallback) ----------------------------------
  await check("Ekubo /tokens", false, async () => {
    const chainId = BigInt(STARKNET_NETWORKS.SN_MAIN.chainId).toString();
    const tokens = await fetchJsonDirect(
      `${EKUBO_DIRECT_BASE}/tokens?chainId=${chainId}&pageSize=1000`,
    );
    const rows = toEkuboRows(tokens.body as never);
    return { status: tokens.status, detail: `${keysOf(tokens.body)} -> ${rows.length} TokenRows` };
  });

  await check("Ekubo live spot trade tape", true, async () => {
    const chainId = BigInt(STARKNET_NETWORKS.SN_MAIN.chainId).toString();
    const marketResponse = await fetchJsonDirect(`${AVNU_MARKETS_DIRECT_BASE}/v3/tokens`);
    const tokens = toAvnuRows(marketResponse.body as never);
    const selected = tokens.find((token) => token.symbol === "STRK");
    const quote = tokens.find(
      (token) => token.symbol === "USDC" && !token.name.toLowerCase().includes("bridged"),
    );
    if (selected === undefined || quote === undefined) {
      throw new Error("AVNU market list did not include STRK/native USDC");
    }
    const { status, body } = await fetchJsonDirect(
      `${EKUBO_DIRECT_BASE}/tokens/${chainId}/${selected.address}/${quote.address}/events`,
    );
    const trades = parseEkuboTokenTrades(body, selected, quote);
    return {
      status,
      detail: `${trades.length} verified fills (latest=${trades[0]?.side ?? "none"})`,
    };
  });

  // ---- Vesu V2 (lending + atomic Multiply routing) -----------------------
  await check("Vesu verified V2 pools", true, async () => {
    const { status, body } = await fetchJsonDirect(
      `${VESU_API_BASE}/pools?protocolVersion=v2&onlyVerified=true&onlyEnabledAssets=true`,
    );
    const parsed = parseVesuMarkets(body, new Date().toISOString());
    if (parsed.poolCount === 0 || parsed.markets.length === 0 || parsed.pairs.length === 0) {
      throw new Error("Vesu returned no verified V2 market inventory");
    }
    return {
      status,
      detail: `${parsed.poolCount} pools / ${parsed.markets.length} assets / ${parsed.pairs.length} pairs`,
    };
  });

  await check("Vesu connected positions", true, async () => {
    const { status, body } = await fetchJsonDirect(
      `${VESU_API_BASE}/users/${SAMPLE_STARKSCAN_ADDRESS}/positions`,
    );
    const positions = parseVesuPositions(body);
    return {
      status,
      detail: `${positions.length} open positions`,
    };
  });

  await check("Vesu Multiply unwind quote", true, async () => {
    const chainId = BigInt(STARKNET_NETWORKS.SN_MAIN.chainId).toString();
    const debtAmount = 1_000_000n;
    const { status, body } = await fetchJsonDirect(
      `https://prod-api-quoter.ekubo.org/${chainId}/-${debtAmount}/${MAINNET_TOKEN_ADDRESSES.USDC}/${MAINNET_TOKEN_ADDRESSES.USDT}`,
    );
    const quote = parseVesuMultiplyExactOutQuote(body, debtAmount, 100);
    return {
      status,
      detail: `max collateral=${quote.maxInputAmount} splits=${quote.splits.length}`,
    };
  });

  // ---- Extended (perps) ---------------------------------------------------
  await check("Extended /info/markets", true, async () => {
    const { status, body } = await fetchJsonDirect(`${EXTENDED_REST_DIRECT_BASE}/info/markets`);
    const markets = parseMarkets(body);
    return { status, detail: `${markets.length} markets (e.g. ${markets.slice(0, 3).map((m) => m.name).join(", ")})` };
  });

  await check(`Extended stats/${SAMPLE_MARKET}`, true, async () => {
    const { status, body } = await fetchJsonDirect(
      `${EXTENDED_REST_DIRECT_BASE}/info/markets/${SAMPLE_MARKET}/stats`,
    );
    const stats = parseMarketStatsResponse(body);
    return { status, detail: stats === null ? "parsed null" : `mark=${stats.markPrice} last=${stats.lastPrice}` };
  });

  await check(`Extended candles/${SAMPLE_MARKET}`, true, async () => {
    const { status, body } = await fetchJsonDirect(
      `${EXTENDED_REST_DIRECT_BASE}/info/candles/${SAMPLE_MARKET}/trades?interval=PT1H&limit=50`,
    );
    const candles = parseCandles(body);
    return { status, detail: `${candles.length} candles (last close=${candles[candles.length - 1]?.close ?? "n/a"})` };
  });

  await check(`Extended funding/${SAMPLE_MARKET}`, true, async () => {
    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000;
    const { status, body } = await fetchJsonDirect(
      `${EXTENDED_REST_DIRECT_BASE}/info/${SAMPLE_MARKET}/funding?startTime=${start}&endTime=${end}`,
    );
    const history = parseFundingHistory(body);
    return { status, detail: `${history.length} funding points` };
  });

  await check(`Extended orderbook/${SAMPLE_MARKET}`, true, async () => {
    const { status, body } = await fetchJsonDirect(
      `${EXTENDED_REST_DIRECT_BASE}/info/markets/${SAMPLE_MARKET}/orderbook`,
    );
    const book = parseOrderBookResponse(body);
    return { status, detail: `${book.bids.length} bids / ${book.asks.length} asks` };
  });

  await check(`Extended stream/${SAMPLE_MARKET}`, true, () =>
    checkExtendedStream(`${EXTENDED_WS_DIRECT_BASE}/publicTrades/${SAMPLE_MARKET}`),
  );

  // ---- Starknet RPC -------------------------------------------------------
  const rpcUrl = RPC_DIRECT_URLS[0];
  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  await check("Starknet RPC chainId", true, async () => {
    const chainId = await provider.getChainId();
    return { status: "rpc", detail: `chainId=${chainId} (${rpcUrl})` };
  });

  await check("Starknet RPC balanceOf(ETH)", true, async () => {
    const res = await provider.callContract(
      { calldata: CallData.compile([ETH]), contractAddress: ETH, entrypoint: "balanceOf" },
      "latest",
    );
    const low = res[0] !== undefined ? BigInt(res[0]) : 0n;
    const high = res[1] !== undefined ? BigInt(res[1]) : 0n;
    return { status: "rpc", detail: `u256 felts=[${res.slice(0, 2).join(", ")}] -> ${low + (high << 128n)}` };
  });

  await check("Vesu V2 deployed ABIs", true, async () => {
    const [poolClass, multiplyClass] = await Promise.all([
      provider.getClassAt(VESU_ADDRESSES.primePoolId),
      provider.getClassAt(VESU_ADDRESSES.multiply),
    ]);
    const names = (abi: unknown): readonly string[] =>
      Array.isArray(abi)
        ? abi.flatMap((entry) => {
            if (typeof entry !== "object" || entry === null) return [];
            const value = entry as { readonly name?: unknown; readonly items?: unknown };
            const own = typeof value.name === "string" ? [value.name] : [];
            const nested = Array.isArray(value.items)
              ? value.items.flatMap((item) =>
                  typeof item === "object" &&
                  item !== null &&
                  typeof (item as { readonly name?: unknown }).name === "string"
                    ? [(item as { readonly name: string }).name]
                    : [],
                )
              : [];
            return [...own, ...nested];
          })
        : [];
    const poolNames = names(poolClass.abi);
    const multiplyNames = names(multiplyClass.abi);
    if (!poolNames.includes("modify_position") || !multiplyNames.includes("modify_lever")) {
      throw new Error("Vesu deployed ABI no longer exposes expected entrypoints");
    }
    return { status: "rpc", detail: "modify_position + modify_lever present" };
  });

  // ---- Summary ------------------------------------------------------------
  // eslint-disable-next-line no-console
  console.log("\n" + "-".repeat(72));
  const failedRequired = results.filter((r) => !r.ok && r.required);
  const failedOptional = results.filter((r) => !r.ok && !r.required);
  const passed = results.filter((r) => r.ok);
  // eslint-disable-next-line no-console
  console.log(
    `Summary: ${passed.length}/${results.length} passed` +
      (failedRequired.length > 0 ? `, ${failedRequired.length} REQUIRED failed` : "") +
      (failedOptional.length > 0 ? `, ${failedOptional.length} optional failed` : ""),
  );
  if (failedRequired.length > 0) {
    // eslint-disable-next-line no-console
    console.log("Required failures: " + failedRequired.map((r) => r.name).join(", "));
    process.exit(1);
  }
  process.exit(0);
};

void main().catch((cause) => {
  // eslint-disable-next-line no-console
  console.error("check:api crashed:", cause);
  process.exit(1);
});
