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
 * The built-in indexer is Starkscan, over the wallet's existing Starkscan
 * connection ({@link StarkscanNftSource}, injected by the wiring). It runs only
 * when the caller sets `starkscan` (NFTs are turned on, the default) and no
 * indexer URL is saved: a saved URL is the user's own choice and replaces it.
 *
 * With neither, discovery resolves to coverage "none" without touching the
 * network, exactly like {@link unavailableNftIndexer}. A transport failure or
 * malformed body resolves to "unavailable", and a partial answer to
 * "incomplete", so the gallery never reads an outage or a gap as "no NFTs".
 */

import { type BoundedHttpFetch, fetchBoundedJson, HTTP_BODY_LIMITS } from "@bramble/core/http-json";
import { isRecord } from "@bramble/core/json";
import { trimTrailingSlashes } from "@bramble/core/service-url";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import { type DiscoveredNft, normalizeIndexerNft } from "./nft-metadata";

/**
 * What one discovery run can say about the candidates it returns:
 * - "none": no indexer ran (the preview is off, the network is not Mainnet
 *   for Starkscan, or the user keeps the explorer off it); only watched NFTs
 *   show.
 * - "complete": the indexer answered and claims its list is whole.
 * - "incomplete": the list may be missing NFTs: Starkscan reports a partial
 *   index or more positions than one page, an indexer listed more than the
 *   wallet's discovery cap or records it could not read, or an on-chain
 *   ownership read failed so a candidate could be neither shown nor ruled out.
 * - "unavailable": the indexer failed or answered something malformed.
 */
export type NftCoverage = "complete" | "incomplete" | "none" | "unavailable";

/** One discovery run: owned-token candidates (still untrusted) and coverage. */
export type NftDiscovery = {
  readonly coverage: NftCoverage;
  readonly nfts: readonly DiscoveredNft[];
};

/**
 * Inputs for listing the NFTs an account owns through the configured indexer.
 */
export type NftIndexerInput = {
  readonly address: string;
  readonly indexerUrl: string | null;
  readonly networkId: StarknetNetworkId;
  /**
   * True only while NFTs are turned on (the default): lets the built-in
   * Starkscan source run when no indexer URL is saved. Absent means off, so a
   * caller that forgets it sends nothing.
   */
  readonly starkscan?: boolean;
};

/**
 * The built-in Starkscan source: owned-token candidates for one address and
 * network, with coverage. It decides for itself whether it may run (Mainnet
 * only, explorer lane permitted) and never throws.
 */
export type StarkscanNftSource = (input: {
  readonly address: string;
  readonly networkId: StarknetNetworkId;
}) => Promise<NftDiscovery>;

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
  readonly listOwnedNfts: (input: NftIndexerInput) => Promise<NftDiscovery>;
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
  `${trimTrailingSlashes(indexerUrl)}/accounts/${address}/nfts?network=${networkId}`;

// Extracts the record array from either a bare array body or a `{ nfts: [...] }`
// envelope; anything else is malformed (null).
const recordsFrom = (body: unknown): readonly unknown[] | null => {
  if (Array.isArray(body)) {
    return body;
  }
  if (isRecord(body) && Array.isArray(body["nfts"])) {
    return body["nfts"];
  }
  return null;
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
// on-chain owner_of re-proofs downstream. A dropped malformed record or a
// trimmed list makes the answer incomplete rather than silently shorter.
const foldDiscovered = (
  records: readonly unknown[],
  networkId: StarknetNetworkId,
): NftDiscovery => {
  const discovered: DiscoveredNft[] = [];
  const seen = new Set<string>();
  let complete = records.length <= MAX_DISCOVERED_NFTS;
  for (const record of records) {
    if (discovered.length >= MAX_DISCOVERED_NFTS) {
      break;
    }
    const nft = normalizeIndexerNft(record, networkId);
    if (nft === null) {
      complete = false;
    } else if (!seen.has(nft.id)) {
      seen.add(nft.id);
      discovered.push(nft);
    }
  }
  return { coverage: complete ? "complete" : "incomplete", nfts: discovered };
};

const NO_DISCOVERY: NftDiscovery = { coverage: "none", nfts: [] };
const UNAVAILABLE: NftDiscovery = { coverage: "unavailable", nfts: [] };

/**
 * Builds an {@link NftIndexerService} over the given HTTP transport and the
 * optional built-in Starkscan source. A saved `indexerUrl` drives the
 * documented wire contract; otherwise, only when `starkscan` is set, the
 * Starkscan source answers; otherwise nothing is sent ("none"). A non-ok
 * response, a transport error, or a malformed body resolves to "unavailable"
 * rather than throwing or claiming an empty account.
 */
export const createHttpNftIndexer = (
  http: NftIndexerHttp,
  starkscanSource?: StarkscanNftSource,
): NftIndexerService => ({
  async listOwnedNfts({ address, indexerUrl, networkId, starkscan }) {
    if (indexerUrl === null) {
      return starkscan === true && starkscanSource
        ? starkscanSource({ address, networkId })
        : NO_DISCOVERY;
    }
    const body = await fetchIndexerBody(http, ownedNftsUrl(indexerUrl, address, networkId));
    const records = body === null ? null : recordsFrom(body);
    return records === null ? UNAVAILABLE : foldDiscovered(records, networkId);
  },
});

/**
 * Offline NFT indexer used when no discovery backend is wired; always "none".
 */
export const unavailableNftIndexer: NftIndexerService = {
  async listOwnedNfts() {
    return NO_DISCOVERY;
  },
};
