import { TOKEN_CREATE_ENABLED } from "../protocols/constants";
/**
 * The four top-level screens and their nav metadata. Shared by the shell and
 * the App router so tab ids stay in sync.
 */
export type ScreenId =
  | "discover"
  | "tokens"
  | "lending"
  | "perps"
  | "privacy"
  | "nfts"
  | "create"
  | "portfolio";

export type ScreenTab = {
  readonly id: ScreenId;
  readonly label: string;
};

/**
 * Every nav tab in order, including ones a feature gate may hide.
 */
const ALL_SCREEN_TABS: readonly ScreenTab[] = [
  { id: "discover", label: "Discover" },
  { id: "tokens", label: "Tokens" },
  { id: "lending", label: "Lending" },
  { id: "perps", label: "Perps" },
  { id: "privacy", label: "Privacy" },
  { id: "nfts", label: "NFT Studio" },
  { id: "create", label: "Create" },
  { id: "portfolio", label: "Portfolio" },
];

/**
 * Nav tabs for the given gates. A gated-off screen has no tab and its hash
 * falls back to Discover, so it cannot be reached by URL either.
 */
export const screenTabs = (gates: { readonly create: boolean }): readonly ScreenTab[] =>
  ALL_SCREEN_TABS.filter((tab) => tab.id !== "create" || gates.create);

/**
 * Ordered nav tabs, matching the mockup's top-nav order.
 */
export const SCREEN_TABS: readonly ScreenTab[] = screenTabs({ create: TOKEN_CREATE_ENABLED });

/**
 * Resolves a same-page Terminal hash to a known screen, falling back to the
 * default Discover workspace for missing or untrusted values.
 */
export const screenFromHash = (hash: string, tabs: readonly ScreenTab[] = SCREEN_TABS): ScreenId => {
  const candidate = hash.replace(/^#/, "");
  return tabs.some((screen) => screen.id === candidate)
    ? (candidate as ScreenId)
    : "discover";
};

/**
 * Formats a Starknet address as the mockup's `0x04a1…8f2c` short form.
 */
export const shortenAddress = (address: string): string =>
  address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
