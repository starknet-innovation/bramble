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
} from "../src/data/endpoints";
import { toAvnuRows, toEkuboRows } from "../src/data/useTokens";
import { toAvnuCandles } from "../src/data/useCandles";
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
import { MAINNET_TOKEN_ADDRESSES } from "../src/protocols/constants";
import { STARKNET_NETWORKS } from "../src/protocols/support/networks";

const REQUEST_TIMEOUT_MS = 15_000;
const SAMPLE_MARKET = "BTC-USD";
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

  await check("AVNU token candles", true, async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 86_400_000);
    const params = new URLSearchParams({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      resolution: "1H",
    });
    const { status, body } = await fetchJsonDirect(
      `${AVNU_MARKETS_DIRECT_BASE}/v3/tokens/${ETH}/prices/candle?${params}`,
    );
    const rows = toAvnuCandles(body as never);
    return { status, detail: `${rows.length} candles (last close=${rows.at(-1)?.close ?? "n/a"})` };
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

  // ---- Ekubo (token universe, fallback) ----------------------------------
  await check("Ekubo /tokens", false, async () => {
    const chainId = BigInt(STARKNET_NETWORKS.SN_MAIN.chainId).toString();
    const tokens = await fetchJsonDirect(
      `${EKUBO_DIRECT_BASE}/tokens?chainId=${chainId}&pageSize=1000`,
    );
    const rows = toEkuboRows(tokens.body as never);
    return { status: tokens.status, detail: `${keysOf(tokens.body)} -> ${rows.length} TokenRows` };
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
