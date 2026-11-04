/**
 * Pinned OpenZeppelin Contracts for Cairo v3.0.0 presets that Create deploys
 * through the Universal Deployer. Each class is already declared on Starknet
 * Mainnet and Sepolia, so a deploy never declares anything: the wallet signs a
 * single UDC `deploy_contract` call whose constructor mints the initial supply.
 *
 * Provenance: the hashes are OpenZeppelin's published Sierra class hashes for
 * v3.0.0 (`docs/modules/ROOT/pages/utils/_class_hashes.adoc` at tag v3.0.0).
 * `starknet_getClass` returned each class on both networks (2026-11-04), with
 * the constructor ABIs encoded below. The v4.0.x preset hashes were not
 * declared on either network at that date, so they are deliberately not used.
 * After a deploy, `verifyDeployedClass` re-reads the class at the new address,
 * so a wrong pin cannot be reported as a successful create.
 */

/** The three token standards Create can deploy. */
export type TokenStandard = "erc20" | "erc721" | "erc1155";

/** Static facts about one pinned preset, shown in the review before signing. */
export type TokenPreset = {
  readonly classHash: string;
  readonly label: string;
  readonly presetName: string;
};

/** OpenZeppelin release the pins come from; shown with every review. */
export const TOKEN_PRESET_RELEASE = "OpenZeppelin Cairo v3.0.0";

/** Source link for the pinned release, opened from the Create screen. */
export const TOKEN_PRESET_SOURCE_URL =
  "https://github.com/OpenZeppelin/cairo-contracts/tree/v3.0.0/packages/presets/src";

/**
 * Pinned preset classes. The same class hash is declared on Mainnet and
 * Sepolia, so one table serves both networks.
 */
export const TOKEN_PRESETS: Readonly<Record<TokenStandard, TokenPreset>> = {
  erc20: {
    classHash: "0x0385b75aa04cfee201d2e2de42daf00a839367cfd740e9042766b447d891fea0",
    label: "ERC-20 token",
    presetName: "ERC20Upgradeable",
  },
  erc721: {
    classHash: "0x0356fbb89f6a6574ff97c4ecc5fe97808785ce0b093c8e864b87a184f48dbd9e",
    label: "ERC-721 collection",
    presetName: "ERC721Upgradeable",
  },
  erc1155: {
    classHash: "0x05a6d419c7a599c9731e8e3a8a710b1f49b4857c65bd4d697a391772f96373c1",
    label: "ERC-1155 collection",
    presetName: "ERC1155Upgradeable",
  },
};

/**
 * The OpenZeppelin `ERC20Upgradeable` preset uses the default 18 decimals;
 * the constructor has no decimals argument, so Create cannot offer one.
 */
export const ERC20_PRESET_DECIMALS = 18;

/** Chains the pins were verified on, by `starknet_chainId` value. */
export const TOKEN_CREATE_CHAIN_IDS: readonly string[] = [
  "0x534e5f4d41494e",
  "0x534e5f5345504f4c4941",
];
