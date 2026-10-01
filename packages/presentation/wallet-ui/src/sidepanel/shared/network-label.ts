/**
 * Short network name for chrome that already implies Starknet: the account
 * bar, flow-header pill, and receipt rows. Every Starknet network drops the
 * prefix, so mainnet reads as "Mainnet" and sepolia as "Sepolia" — the chain
 * is never the question there, which network is. Any other name is shown as
 * stored. Pure string shaping over trusted preference text; callers still
 * escape it before rendering.
 */
export const networkDisplayName = (network: string): string => network.replace(/^Starknet\s+/, "");
