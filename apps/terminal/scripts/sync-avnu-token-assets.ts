/**
 * Downloads AVNU's current Starknet token artwork into a same-origin asset
 * pack. CoinGecko thumbnails are upgraded to their 250 px equivalents before
 * download; unsafe or unavailable images are omitted so the UI fails soft.
 */
import { mkdir, readdir, unlink } from "node:fs/promises";
import { canonicalAddress } from "../src/protocols/support/networks";

const TOKEN_URL = "https://starknet.impulse.avnu.fi/v3/tokens";
const ASSET_DIRECTORY = new URL("../public/token-assets/avnu/", import.meta.url);
const MANIFEST = new URL("../src/assets/avnu-token-assets.json", import.meta.url);
const MAX_ASSET_BYTES = 5_000_000;
const BATCH_SIZE = 12;

type AvnuToken = {
  readonly address?: unknown;
  readonly logoUri?: unknown;
};

type AssetKind = {
  readonly extension: "jpg" | "png" | "svg" | "webp";
  readonly mime: string;
};

const ASSET_KINDS: readonly AssetKind[] = [
  { extension: "svg", mime: "image/svg+xml" },
  { extension: "png", mime: "image/png" },
  { extension: "jpg", mime: "image/jpeg" },
  { extension: "webp", mime: "image/webp" },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const tokenList = (payload: unknown): readonly AvnuToken[] => {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (isRecord(payload) && Array.isArray(payload.content)) {
    return payload.content.filter(isRecord);
  }
  throw new Error("AVNU token response did not contain a token array");
};

const highFidelityUri = (uri: string): string =>
  uri.replace(
    /^(https:\/\/assets\.coingecko\.com\/coins\/images\/\d+)\/(?:small|standard)\//,
    "$1/large/",
  );

const assetKind = (contentType: string | null): AssetKind | null =>
  ASSET_KINDS.find((kind) => contentType?.toLowerCase().startsWith(kind.mime) === true) ?? null;

const isSafeSvg = (bytes: Uint8Array): boolean => {
  const svg = new TextDecoder().decode(bytes).trim().toLowerCase();
  const svgStart = svg.indexOf("<svg");
  const preamble =
    svgStart < 0
      ? svg
      : svg
          .slice(0, svgStart)
          .replace(/<\?xml[\s\S]*?\?>/g, "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .trim();
  return (
    svgStart >= 0 &&
    preamble === "" &&
    !/<script(?:\s|>)/.test(svg) &&
    !/<foreignobject(?:\s|>)/.test(svg) &&
    !/javascript\s*:/.test(svg) &&
    !/\son[a-z]+\s*=/.test(svg) &&
    !/<!entity(?:\s|>)/.test(svg)
  );
};

const hasRasterSignature = (kind: AssetKind, bytes: Uint8Array): boolean => {
  if (kind.extension === "png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (kind.extension === "jpg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (kind.extension === "webp") {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
};

const download = async (
  token: AvnuToken,
): Promise<readonly [address: string, filename: string] | null> => {
  if (typeof token.address !== "string" || typeof token.logoUri !== "string") {
    return null;
  }
  const address = canonicalAddress(token.address);
  if (address === null) {
    return null;
  }
  try {
    const response = await fetch(highFidelityUri(token.logoUri), {
      headers: {
        accept: "image/avif,image/webp,image/svg+xml,image/png,image/jpeg",
        "accept-encoding": "identity",
        referer: "https://app.avnu.fi/",
        "user-agent": "Mozilla/5.0 MC-Wallet-Token-Asset-Sync",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    const kind = assetKind(response.headers.get("content-type"));
    if (!response.ok || kind === null) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.length === 0 ||
      bytes.length > MAX_ASSET_BYTES ||
      (kind.extension === "svg" ? !isSafeSvg(bytes) : !hasRasterSignature(kind, bytes))
    ) {
      return null;
    }
    const filename = `${address}.${kind.extension}`;
    await Bun.write(new URL(filename, ASSET_DIRECTORY), bytes);
    return [address, filename];
  } catch {
    return null;
  }
};

const response = await fetch(TOKEN_URL, {
  headers: { accept: "application/json", "accept-encoding": "identity" },
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  throw new Error(`AVNU token request failed (${response.status})`);
}

const tokens = tokenList(await response.json());
await mkdir(ASSET_DIRECTORY, { recursive: true });
await mkdir(new URL("../src/assets/", import.meta.url), { recursive: true });

const entries: Array<readonly [string, string]> = [];
for (let index = 0; index < tokens.length; index += BATCH_SIZE) {
  const results = await Promise.all(tokens.slice(index, index + BATCH_SIZE).map(download));
  entries.push(...results.filter((entry) => entry !== null));
}

const manifest = Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
const currentFiles = new Set(Object.values(manifest));
for (const filename of await readdir(ASSET_DIRECTORY)) {
  if (!currentFiles.has(filename)) {
    await unlink(new URL(filename, ASSET_DIRECTORY));
  }
}
await Bun.write(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `AVNU token artwork: ${entries.length}/${tokens.length} downloaded; ` +
    `${tokens.length - entries.length} use a provider URL or ticker fallback.`,
);
