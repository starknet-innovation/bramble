/**
 * HTTP-backed NFT auto-discovery indexer client.
 *
 * ERC-721 ownership cannot be enumerated over plain RPC, so listing the
 * NFTs an account owns needs an external indexer (ERC-1155 balances are not
 * handled: verification re-proves each token through `owner_of`). Following the
 * STRK20 prover
 * model, the wallet points at an operator-configured indexer URL and speaks one
 * documented wire contract; network access is injected (`http`) so this module
 * stays testable without a real network. Nothing here is trusted on its own: the
 * background handler re-proves ownership of every returned token against the
 * on-chain `owner_of` before it reaches the gallery.
 *
 * Wire contract (GET, JSON response, every record validated on return):
 *   GET {indexerUrl}/accounts/{address}/nfts?network={networkId}
 *     -> NftRecord[]  |  { nfts: NftRecord[] }
 *   NftRecord = { contract_address, token_id, name?, collection_name?, image_url? }
 *
 * A null `indexerUrl` means the wallet is unconfigured: discovery resolves to an
 * empty list without touching the network, exactly like
 * {@link unavailableNftIndexer}. Any transport failure or malformed body also
 * degrades to an empty list, so a discovery outage never blocks the gallery — it
 * simply shows the empty state and the manual watch form.
 */
import { type BoundedHttpFetch, fetchBoundedJson, HTTP_BODY_LIMITS } from "../shared/http-json";
import { isRecord } from "../shared/json";
import type { StarknetNetworkId } from "./networks";
import { type DiscoveredNft, normalizeIndexerNft } from "./nft-metadata";

/**
 * Inputs for listing the NFTs an account owns through the configured indexer.
 */
export type NftIndexerInput = {
  readonly address: string;
  readonly indexerUrl: string | null;
  readonly networkId: StarknetNetworkId;
};

/**
 * The injected HTTP transport, `fetch`-shaped so the wiring that owns network
 * access forwards the boundary's request options and deadline straight through.
 * Reads go through the shared bounded reader, so an indexer answering with an
 * endless or never-finished body is cut off rather than buffered into the
 * worker.
 */
export type NftIndexerHttp = BoundedHttpFetch;

/**
 * Injectable NFT discovery service used by the background message handler.
 */
export type NftIndexerService = {
  readonly listOwnedNfts: (input: NftIndexerInput) => Promise<readonly DiscoveredNft[]>;
};

/**
 * Hard cap on how many candidate NFTs one discovery response may enqueue. Each
 * candidate costs an on-chain `owner_of` re-proof in the background, so a hostile
 * or oversized indexer must not be able to fan out unbounded RPC per render;
 * records past the cap are dropped here at the untrusted boundary.
 */
export const MAX_DISCOVERED_NFTS = 100;

// Joins the configured indexer base URL with the ownership sub-path, tolerating a
// trailing slash on the base so both `https://i` and `https://i/` behave.
const ownedNftsUrl = (indexerUrl: string, address: string, networkId: StarknetNetworkId): string =>
  `${indexerUrl.replace(/\/+$/, "")}/accounts/${address}/nfts?network=${networkId}`;

// Extracts the record array from either a bare array body or a `{ nfts: [...] }`
// envelope; anything else yields no records.
const recordsFrom = (body: unknown): readonly unknown[] => {
  if (Array.isArray(body)) {
    return body;
  }
  if (isRecord(body) && Array.isArray(body["nfts"])) {
    return body["nfts"];
  }
  return [];
};

// Fetches and JSON-parses the indexer response, degrading to null on a non-ok
// status, a transport error, an over-budget body, an exchange that outlives its
// deadline, or a malformed body — so a discovery outage surfaces as an empty
// gallery rather than a thrown error or a parked request.
const fetchIndexerBody = async (http: NftIndexerHttp, url: string): Promise<unknown | null> => {
  try {
    return await fetchBoundedJson(http, url, HTTP_BODY_LIMITS.nftIndexer);
  } catch {
    return null;
  }
};

// Pure fold of the untrusted record list into canonical NFTs: drops any record
// that fails normalization or duplicates one already kept, and stops at
// MAX_DISCOVERED_NFTS so a hostile or oversized indexer cannot fan out unbounded
// on-chain owner_of re-proofs downstream.
const dedupeDiscovered = (
  records: readonly unknown[],
  networkId: StarknetNetworkId,
): DiscoveredNft[] => {
  const discovered: DiscoveredNft[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (discovered.length >= MAX_DISCOVERED_NFTS) {
      break;
    }
    const nft = normalizeIndexerNft(record, networkId);
    if (nft && !seen.has(nft.id)) {
      seen.add(nft.id);
      discovered.push(nft);
    }
  }
  return discovered;
};

/**
 * Builds an {@link NftIndexerService} over the given HTTP transport. A null
 * `indexerUrl` reproduces the unavailable behavior; a set URL drives the
 * documented wire contract, dropping any record that fails normalization and
 * resolving to an empty list on a non-ok response, a transport error, or a
 * malformed body rather than throwing.
 */
export const createHttpNftIndexer = (http: NftIndexerHttp): NftIndexerService => ({
  async listOwnedNfts({ address, indexerUrl, networkId }) {
    if (indexerUrl === null) {
      return [];
    }
    const body = await fetchIndexerBody(http, ownedNftsUrl(indexerUrl, address, networkId));
    return dedupeDiscovered(recordsFrom(body), networkId);
  },
});

/**
 * Offline NFT indexer used when no discovery backend is wired; always empty.
 */
export const unavailableNftIndexer: NftIndexerService = {
  async listOwnedNfts() {
    return [];
  },
};
