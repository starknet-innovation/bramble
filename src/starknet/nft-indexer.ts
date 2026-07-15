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
 * The injected HTTP transport: a `fetch`-shaped function whose `ok` flag and
 * JSON body the client inspects.
 */
export type NftIndexerHttp = (
  url: string,
) => Promise<{ readonly ok: boolean; readonly json: () => Promise<unknown> }>;

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
    let body: unknown;
    try {
      const response = await http(ownedNftsUrl(indexerUrl, address, networkId));
      if (!response.ok) {
        return [];
      }
      body = await response.json();
    } catch {
      return [];
    }
    const discovered: DiscoveredNft[] = [];
    const seen = new Set<string>();
    for (const record of recordsFrom(body)) {
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
