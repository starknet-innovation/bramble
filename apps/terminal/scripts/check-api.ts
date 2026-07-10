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
 *   # optional: raise CoinGecko's rate limit with a demo key
 *   VITE_COINGECKO_API_KEY=CG-xxxx bun run check:api
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
  COINGECKO_DIRECT_BASE,
  coingeckoHeaders,
  EKUBO_DIRECT_BASE,
  EXTENDED_REST_DIRECT_BASE,
  RPC_DIRECT_URLS,
} from "../src/data/endpoints";
import { toEntry } from "../src/data/usePrices";
import { toAvnuRows, toEkuboRows } from "../src/data/useTokens";
import {
  parseCandles,
  parseFundingHistory,
  parseMarketStatsResponse,
  parseMarkets,
  parseOrderBookResponse,
} from "../src/data/extended/parse";
import { MAINNET_TOKEN_ADDRESSES } from "../src/protocols/constants";

const REQUEST_TIMEOUT_MS = 15_000;
const SAMPLE_MARKET = "BTC-USD";

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
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", ...headers },
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

const main = async (): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log("Trade Terminal — live API check (direct hosts, no proxy)\n");
  const cg = coingeckoHeaders();
  if (Object.keys(cg).length > 0) {
    // eslint-disable-next-line no-console
    console.log("Using CoinGecko demo API key from VITE_COINGECKO_API_KEY.\n");
  }

  const ETH = MAINNET_TOKEN_ADDRESSES.ETH;
  const STRK = MAINNET_TOKEN_ADDRESSES.STRK;

  // ---- CoinGecko ----------------------------------------------------------
  // NOTE: without a CoinGecko API key the public `token_price` endpoint is capped
  // to a SINGLE contract address (multiple 400 with error_code 10012). The app
  // tolerates this (it falls back to `/simple/price` majors), so the required
  // check uses one address; the multi-address behavior is only exercised (and
  // only expected to pass) when VITE_COINGECKO_API_KEY is set.
  await check("CoinGecko token_price/starknet", true, async () => {
    const url =
      `${COINGECKO_DIRECT_BASE}/api/v3/simple/token_price/starknet` +
      `?contract_addresses=${ETH}&vs_currencies=usd&include_24hr_change=true`;
    const { status, body } = await fetchJsonDirect(url, cg);
    const first = Object.values(body as Record<string, unknown>)[0];
    const entry = toEntry(first as { usd?: number } | undefined);
    return { status, detail: `${keysOf(body)} -> parsed usd=${entry.usd}` };
  });

  if (Object.keys(cg).length > 0) {
    await check("CoinGecko token_price (multi, keyed)", true, async () => {
      const url =
        `${COINGECKO_DIRECT_BASE}/api/v3/simple/token_price/starknet` +
        `?contract_addresses=${ETH},${STRK}&vs_currencies=usd&include_24hr_change=true`;
      const { status, body } = await fetchJsonDirect(url, cg);
      return { status, detail: `${keysOf(body)}` };
    });
  }

  await check("CoinGecko simple/price", true, async () => {
    const url =
      `${COINGECKO_DIRECT_BASE}/api/v3/simple/price` +
      `?ids=starknet,ethereum,usd-coin&vs_currencies=usd&include_24hr_change=true`;
    const { status, body } = await fetchJsonDirect(url, cg);
    const strk = (body as Record<string, { usd?: number }>).starknet;
    return { status, detail: `${keysOf(body)} -> STRK usd=${toEntry(strk).usd}` };
  });

  // ---- Avnu (token universe, primary) ------------------------------------
  await check("Avnu /swap/v2/tokens", true, async () => {
    const { status, body } = await fetchJsonDirect(`${AVNU_DIRECT_BASE}/swap/v2/tokens`);
    const rows = toAvnuRows(body as never);
    return { status, detail: `${keysOf(body)} -> ${rows.length} TokenRows (first symbol=${rows[0]?.symbol ?? "n/a"})` };
  });

  // ---- Ekubo (token universe, fallback) ----------------------------------
  await check("Ekubo /tokens", false, async () => {
    const tokens = await fetchJsonDirect(`${EKUBO_DIRECT_BASE}/tokens`);
    let pairs: unknown = [];
    try {
      pairs = (await fetchJsonDirect(`${EKUBO_DIRECT_BASE}/pairs`)).body;
    } catch {
      // pairs volume is optional enrichment
    }
    const rows = toEkuboRows(tokens.body as never, pairs as never);
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
