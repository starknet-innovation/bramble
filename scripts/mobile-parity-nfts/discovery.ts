/**
 * The discovery blocks: `indexer` (a saved indexer URL, the documented wire contract) and
 * `starkscan` (no URL saved, the built-in Starkscan source), both through the production
 * composition `createHttpNftIndexer(http, createStarkscanNftSource(..))` over the real Starkscan
 * client, with a recording transport. Each case is the input `listOwnedNfts` gets, the explorer
 * preferences it reads, every request as sent with the reply given, and the discovery it
 * returns (candidates still untrusted: the re-proof is the `discover` block's).
 *
 * Starkscan pages are the extension's schema-derived fixtures
 * (`packages/features/transactions/tests/support/starkscan-nft-fixture.ts`), not a live capture.
 */
import { createHttpNftIndexer, MAX_DISCOVERED_NFTS } from "@bramble/portfolio/nft-indexer";
import { createStarkscanClient } from "@bramble/transactions/starkscan";
import { createStarkscanNftSource } from "@bramble/transactions/starkscan-nfts";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { ExplorerLanePreferences } from "@bramble/wallet-model/preferences";
import {
  STARKSCAN_OWNER,
  starkscanCoverage,
  starkscanPage,
  starkscanPosition,
} from "../../packages/features/transactions/tests/support/starkscan-nft-fixture";
import { ERC721, type HttpExchange, type HttpReply, plain, recordingHttp } from "./shared";

/** The bundled explorer base the extension reads (`DEFAULT_EXPLORER_API_URL`). */
const STARKSCAN_BASE = "https://starkscan.co/v1";
const INDEXER = "https://indexer.example/api";
const OWNER = STARKSCAN_OWNER;

type Case = {
  readonly name: string;
  readonly reply: HttpReply;
  readonly indexerUrl?: string | null;
  readonly networkId?: StarknetNetworkId;
  readonly starkscan?: boolean;
  readonly preferences?: ExplorerLanePreferences;
  readonly address?: string;
};

const run = async (one: Case) => {
  const exchanges: HttpExchange[] = [];
  const http = recordingHttp(() => one.reply, exchanges);
  const preferences = one.preferences ?? {};
  const client = createStarkscanClient({ baseUrl: STARKSCAN_BASE, http });
  const service = createHttpNftIndexer(
    http,
    createStarkscanNftSource({
      client,
      // As the production wiring does: an explorer base override gets its own client.
      clientFor: (networkId, stored) =>
        createStarkscanClient({
          baseUrl: stored.explorerApiUrls?.[networkId] ?? STARKSCAN_BASE,
          http,
        }),
      readPreferences: async () => preferences,
    }),
  );
  const input = {
    address: one.address ?? OWNER,
    indexerUrl: one.indexerUrl ?? null,
    networkId: one.networkId ?? "SN_MAIN",
    ...(one.starkscan === undefined ? { starkscan: true } : { starkscan: one.starkscan }),
  };
  const result = await service.listOwnedNfts(input);
  return { exchanges, input, name: one.name, preferences, result: plain(result) };
};

const record = (contract: string, tokenId: unknown, extra: Record<string, unknown> = {}) => ({
  contract_address: contract,
  token_id: tokenId,
  ...extra,
});
const many = (count: number) =>
  Array.from({ length: count }, (_, index) => record(ERC721, String(index)));

const indexer = (name: string, reply: HttpReply, over: Partial<Case> = {}): Case => ({
  indexerUrl: INDEXER,
  name,
  reply,
  ...over,
});

const INDEXER_CASES: readonly Case[] = [
  indexer("a bare array of records", {
    body: [
      record(`0x00${ERC721.slice(2).toUpperCase()}`, 7, {
        collection_name: "  Punks  ",
        image_url: "ipfs://ipfs/bafybeigdyrzt/7.png",
        name: "Punk #7",
      }),
      record(ERC721, " 8 ", { image_url: "http://insecure.example/8.png", name: "x".repeat(140) }),
    ],
  }),
  indexer("a { nfts } envelope", {
    body: { nfts: [record(ERC721, "9", { image_url: "https://img.example/9.png" })] },
  }),
  indexer("a base URL with trailing slashes", { body: [] }, { indexerUrl: `${INDEXER}//` }),
  indexer("on Sepolia", { body: [] }, { networkId: "SN_SEPOLIA" }),
  indexer(
    "a saved URL runs even with the built-in source off",
    { body: [record(ERC721, "1")] },
    { starkscan: false },
  ),
  indexer("an object without nfts", { body: { items: [] } }),
  indexer("nfts that is not an array", { body: { nfts: {} } }),
  indexer("a body that is not JSON", { body: "<html>", raw: true }),
  indexer("an HTTP error", { body: { error: "busy" }, status: 503 }),
  indexer("a transport failure", "transport"),
  indexer("a declared body past the 4 MiB budget", {
    body: [],
    headers: { "content-length": String(4 * 1024 * 1024 + 1) },
  }),
  indexer("malformed and duplicate records are dropped, the list is incomplete", {
    body: [
      record(ERC721, "1"),
      "not a record",
      { token_id: "2" },
      record("0x0", "3"),
      record("0xzz", "4"),
      record(`0x8${"0".repeat(63)}`, "5"),
      record(ERC721, "-6"),
      record(ERC721, "7".repeat(79)),
      record(ERC721, 1.5),
      record(ERC721, "0x10"),
      record(ERC721, null),
      record(`0x${ERC721.slice(2).padStart(64, "0")}`, "1"),
      record(ERC721, "8".repeat(78)),
    ],
  }),
  indexer(`exactly the cap (${MAX_DISCOVERED_NFTS} records)`, { body: many(MAX_DISCOVERED_NFTS) }),
  indexer("one record past the cap: the first 100 kept, incomplete", {
    body: many(MAX_DISCOVERED_NFTS + 1),
  }),
  indexer("a malformed record within the cap still counts the rest", {
    body: ["bad", ...many(MAX_DISCOVERED_NFTS)],
  }),
  indexer("duplicates past the cap are skipped while filling it", {
    body: [record(ERC721, "0"), ...many(MAX_DISCOVERED_NFTS)],
  }),
];

const page = (...args: Parameters<typeof starkscanPage>): HttpReply => ({
  body: starkscanPage(...args),
});

const STARKSCAN_CASES: readonly Case[] = [
  { name: "NFTs turned off: no request", reply: page(), starkscan: false },
  { name: "Sepolia: no request", networkId: "SN_SEPOLIA", reply: page() },
  {
    name: "the explorer lane turned off for Mainnet: no request",
    preferences: { explorerFallback: { SN_MAIN: false } },
    reply: page(),
  },
  {
    name: "an RPC override with no explorer choice: no request",
    preferences: { rpcOverrides: { SN_MAIN: "https://rpc.example" } },
    reply: page(),
  },
  {
    name: "an RPC override with the explorer allowed",
    preferences: {
      explorerFallback: { SN_MAIN: true },
      rpcOverrides: { SN_MAIN: "https://rpc.example" },
    },
    reply: page(),
  },
  {
    name: "an explorer base override",
    preferences: { explorerApiUrls: { SN_MAIN: "https://explorer.example/v1" } },
    reply: page(),
  },
  { name: "a complete page", reply: page() },
  { name: "an empty complete page", reply: page([]) },
  {
    name: "a hex token id and an uppercase padded contract",
    reply: page([starkscanPosition("0xff", { tokenAddress: "0x0511A2B3" })]),
  },
  {
    name: "the largest u256 token id",
    reply: page([starkscanPosition(((1n << 256n) - 1n).toString())]),
  },
  {
    name: "a token id past u256",
    reply: page([starkscanPosition((1n << 256n).toString())]),
  },
  { name: "a zero contract", reply: page([starkscanPosition("1", { tokenAddress: "0x0" })]) },
  { name: "a duplicate position", reply: page([starkscanPosition("1"), starkscanPosition("0x1")]) },
  {
    name: "a page for another owner",
    reply: page(undefined, { ownerAddress: "0x1234" }),
  },
  { name: "a page for another chain", reply: page(undefined, { chainId: "SN_SEPOLIA" }) },
  {
    name: "the owner in another spelling",
    reply: page(undefined, { ownerAddress: `0x${OWNER.slice(2).padStart(64, "0").toUpperCase()}` }),
  },
  {
    name: "a partial index",
    reply: page(undefined, { coverage: starkscanCoverage({ status: "partial" }) }),
  },
  { name: "more than one page", reply: page(undefined, { hasMore: true, nextCursor: "c2" }) },
  {
    name: "incomplete within scope",
    reply: page(undefined, { coverage: starkscanCoverage({ completeWithinScope: false }) }),
  },
  {
    name: "another declared scope",
    reply: page(undefined, { coverage: starkscanCoverage({ declaredScope: "everything" }) }),
  },
  {
    name: "a gap other than the ERC-1155 exclusion",
    reply: page(undefined, {
      coverage: starkscanCoverage({ reasonCodes: ["unsupported_erc1155", "lagging"] }),
    }),
  },
  {
    name: "no reason codes",
    reply: page(undefined, { coverage: starkscanCoverage({ reasonCodes: [] }) }),
  },
  {
    name: "collection names: trimmed, unindexed, too long, controls and bidi",
    reply: page([
      starkscanPosition("1", {
        collection: { metadataStatus: "indexed", name: "  Punks ", symbol: null },
      }),
      starkscanPosition("2", {
        collection: { metadataStatus: "unavailable", name: "Hidden", symbol: null },
      }),
      starkscanPosition("3", {
        collection: { metadataStatus: "indexed", name: "x".repeat(65), symbol: null },
      }),
      starkscanPosition("4", {
        collection: { metadataStatus: "indexed", name: "x".repeat(64), symbol: null },
      }),
      starkscanPosition("5", {
        collection: { metadataStatus: "indexed", name: "Pun‮ks", symbol: null },
      }),
      starkscanPosition("6", {
        collection: { metadataStatus: "indexed", name: "Pun\u0007ks", symbol: null },
      }),
      starkscanPosition("7", {
        collection: { metadataStatus: "indexed", name: null, symbol: null },
      }),
    ]),
  },
  { name: "another schema version", reply: page(undefined, { schemaVersion: "v2" }) },
  {
    name: "an ERC-1155 position",
    reply: page([starkscanPosition("1", { standard: "erc1155" })]),
  },
  {
    name: "more positions than a page",
    reply: page(Array.from({ length: 101 }, (_, index) => starkscanPosition(String(index)))),
  },
  { name: "a rate limit", reply: { body: { error: "slow down" }, status: 429 } },
  { name: "a transport failure", reply: "transport" },
];

/** The `indexer` block. */
export const computeIndexer = async () => {
  const cases = [];
  for (const one of INDEXER_CASES) cases.push(await run(one));
  return cases;
};

/** The `starkscan` block. */
export const computeStarkscan = async () => {
  const cases = [];
  for (const one of STARKSCAN_CASES) cases.push(await run(one));
  return cases;
};
