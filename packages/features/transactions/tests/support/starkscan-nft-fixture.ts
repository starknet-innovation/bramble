/**
 * SCHEMA-DERIVED Starkscan NFT positions fixtures, NOT a live capture.
 *
 * Hand-built from Starkscan's published OpenAPI schemas
 * `AddressNftPositionsView`, `NftPositionView`, `NftPositionCollectionView`
 * and `NftPositionCoverageView` (read 2026-11-06). Live replies can differ
 * from a schema (for example `null` against an absent field, as PR 850 found),
 * so a verbatim capture must join them before the preview leaves preview.
 * Every required key is present.
 * Addresses are stand-ins, not real contracts.
 */

/** The owner every page below answers for. */
export const STARKSCAN_OWNER = `0x0${"1234567890abcdef".repeat(4).slice(1)}`;
/** A stand-in ERC-721 contract. */
export const STARKSCAN_COLLECTION = "0x511a2b3";

/** One schema-shaped position. */
export const starkscanPosition = (
  tokenId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  collection: { metadataStatus: "indexed", name: "Punks", symbol: "PNK" },
  evidenceSource: "indexed_erc721_ownership",
  lastTransferHash: "0x7a1b",
  observedAtBlock: 1_200_000,
  standard: "erc721",
  tokenAddress: STARKSCAN_COLLECTION,
  tokenId,
  ...overrides,
});

/** Schema-shaped coverage; complete within scope unless overridden. */
export const starkscanCoverage = (
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  completeWithinScope: true,
  declaredScope: "indexed_standard_erc721_transfers",
  globallyComplete: false,
  indexedFromBlock: 0,
  indexedThroughBlock: 1_250_000,
  reasonCodes: ["unsupported_erc1155"],
  status: "ready",
  ...overrides,
});

/** A schema-shaped page for {@link STARKSCAN_OWNER}. */
export const starkscanPage = (
  items: readonly unknown[] = [starkscanPosition("1"), starkscanPosition("2")],
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  chainId: "SN_MAIN",
  coverage: starkscanCoverage(),
  hasMore: false,
  items,
  nextCursor: null,
  ownerAddress: STARKSCAN_OWNER,
  schemaVersion: "starkscan.nft_positions.v1",
  snapshotBlock: 1_250_000,
  ...overrides,
});
