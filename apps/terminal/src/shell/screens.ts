/**
 * The four top-level screens and their nav metadata. Shared by the shell and
 * the App router so tab ids stay in sync.
 */
export type ScreenId = "discover" | "tokens" | "perps" | "nfts" | "portfolio";

export type ScreenTab = {
  readonly id: ScreenId;
  readonly label: string;
};

/**
 * Ordered nav tabs, matching the mockup's top-nav order.
 */
export const SCREEN_TABS: readonly ScreenTab[] = [
  { id: "discover", label: "Discover" },
  { id: "tokens", label: "Tokens" },
  { id: "perps", label: "Perps" },
  { id: "nfts", label: "NFT Studio" },
  { id: "portfolio", label: "Portfolio" },
];

/**
 * Formats a Starknet address as the mockup's `0x04a1…8f2c` short form.
 */
export const shortenAddress = (address: string): string =>
  address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
