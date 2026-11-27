/**
 * NFTs from the extension's own code, for the mobile core's port (wallet-core P17). Blocks:
 *
 * - `indexer`, `starkscan`: discovery, through the production composition of a saved indexer
 *   URL and the built-in Starkscan source (`discovery.ts`);
 * - `ownership`, `tokenUri`: the on-chain re-proof and the metadata URI read, over a fake node,
 *   every `starknet_call` as sent (`chain.ts`);
 * - `metadata`, `image`: the metadata document and the art normalisers (`metadata.ts`);
 * - `calls`: the ERC-721 and ERC-1155 transfer calls (`chain.ts`);
 * - `watched`: the watched-NFT record, its validator, the gallery's candidate rules and the
 *   preference writes (`watched.ts`);
 * - `discover`, `addNft`, `transfer`, `watchAsset`: the background's message handler end to end
 *   (`flows.ts`, `watch.ts`, `transfer.ts`).
 *
 * Left out: `withRpcFallback`'s endpoint order and cooldowns (shared with every read), the
 * snapshot cache (`nft-snapshot-cache.ts`, a host concern), and the panel's message parsers
 * past what the handler cases show. `bun run mobile:parity` writes it; the drift test fails when
 * the extension's code changes it. Every address is made up but for the parity phrase's
 * accounts.
 */
import { computeCalls, computeOwnership, computeTokenUri } from "./chain";
import { computeIndexer, computeStarkscan } from "./discovery";
import { computeAddNft, computeDiscover } from "./flows";
import { computeImages, computeMetadata } from "./metadata";
import { computeTransfer } from "./transfer";
import { computeWatchAsset } from "./watch";
import { computeWatched } from "./watched";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const NFTS_PARITY_FIXTURE_PATH = "mobile/core/tests/fixtures/extension-nfts.jsonl";

/**
 * Runs the extension's code for every case (deterministic) and renders one JSON line per case,
 * `{"block": <block>, "name": .., ...}`, so the formatter never reflows generated data.
 */
export const renderNftsParity = async (): Promise<string> => {
  const blocks: readonly (readonly [string, readonly object[]])[] = [
    ["indexer", await computeIndexer()],
    ["starkscan", await computeStarkscan()],
    ["ownership", await computeOwnership()],
    ["tokenUri", await computeTokenUri()],
    ["metadata", await computeMetadata()],
    ["image", computeImages()],
    ["calls", computeCalls()],
    ["watched", await computeWatched()],
    ["discover", await computeDiscover()],
    ["addNft", await computeAddNft()],
    ["watchAsset", await computeWatchAsset()],
    ["transfer", await computeTransfer()],
  ];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
