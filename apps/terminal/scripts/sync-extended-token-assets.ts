/**
 * Downloads the current Extended perpetual-market artwork into the terminal's
 * public asset pack and regenerates the exact symbol manifest used at runtime.
 * Missing CDN artwork is deliberately skipped so TokenIcon keeps its fallback.
 */
import { mkdir } from "node:fs/promises";
import { EXTENDED_REST_DIRECT_BASE } from "../src/data/core/endpoints";
import { isSafeSvg, MAX_SVG_LENGTH } from "./token-asset-policy";

const MARKET_URL = `${EXTENDED_REST_DIRECT_BASE}/info/markets`;
const CDN_BASE = "https://cdn.extended.exchange/crypto";
const ASSET_DIRECTORY = new URL("../public/token-assets/extended/", import.meta.url);
const MANIFEST = new URL("../src/assets/extended-token-symbols.json", import.meta.url);
const SYMBOL_PATTERN = /^[A-Za-z0-9_.-]+$/;
const BATCH_SIZE = 20;

type MarketRecord = {
  readonly assetName?: unknown;
  readonly type?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const marketSymbols = (payload: unknown): readonly string[] => {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Extended markets response did not contain a data array");
  }
  const symbols = payload.data.flatMap((value) => {
    if (!isRecord(value)) {
      return [];
    }
    const market = value as MarketRecord;
    if (market.type !== null && market.type !== undefined && market.type !== "PERPETUAL") {
      return [];
    }
    return typeof market.assetName === "string" && SYMBOL_PATTERN.test(market.assetName)
      ? [market.assetName]
      : [];
  });
  return [...new Set(symbols)].sort();
};

const download = async (symbol: string): Promise<string | null> => {
  try {
    const response = await fetch(`${CDN_BASE}/${encodeURIComponent(symbol)}.svg`, {
      headers: { accept: "image/svg+xml" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("image/svg+xml")) {
      return null;
    }
    // Refuse an oversized document before buffering it (Sherlock 143).
    if (Number(response.headers.get("content-length") ?? 0) > MAX_SVG_LENGTH * 4) {
      return null;
    }
    const svg = await response.text();
    if (!isSafeSvg(svg)) {
      return null;
    }
    await Bun.write(new URL(`${symbol}.svg`, ASSET_DIRECTORY), svg);
    return symbol;
  } catch {
    return null;
  }
};

const response = await fetch(MARKET_URL, {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  throw new Error(`Extended markets request failed (${response.status})`);
}

const symbols = marketSymbols(await response.json());
await mkdir(ASSET_DIRECTORY, { recursive: true });
await mkdir(new URL("../src/assets/", import.meta.url), { recursive: true });

const downloaded: string[] = [];
for (let index = 0; index < symbols.length; index += BATCH_SIZE) {
  const batch = symbols.slice(index, index + BATCH_SIZE);
  const results = await Promise.all(batch.map(download));
  downloaded.push(...results.filter((value): value is string => value !== null));
}

await Bun.write(MANIFEST, `${JSON.stringify(downloaded.sort(), null, 2)}\n`);
console.log(
  `Extended token artwork: ${downloaded.length}/${symbols.length} downloaded; ` +
    `${symbols.length - downloaded.length} use the ticker fallback.`,
);
