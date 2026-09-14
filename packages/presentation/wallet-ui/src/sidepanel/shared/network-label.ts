/**
 * Short network name for chrome that already implies Starknet: the account
 * bar, flow-header pill, and receipt rows. "Starknet Mainnet" reads as
 * "Starknet", other Starknet networks drop the prefix ("Sepolia"), and any
 * other name is shown as stored. Pure string shaping over trusted preference
 * text; callers still escape it before rendering.
 */
export const networkDisplayName = (network: string): string =>
  network.replace(/^Starknet Mainnet$/, "Starknet").replace(/^Starknet\s+/, "");
