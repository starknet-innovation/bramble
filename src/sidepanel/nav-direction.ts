/**
 * Pure view-transition direction model for the side panel shell. Screens form a
 * shallow hierarchy — dock screens at the root, flows one level deeper, detail
 * screens deeper still — and a navigation's direction follows the change in
 * depth, so the entrypoint can pick a spatially consistent transition
 * (see ./styles-transitions.ts) without any DOM or runtime state.
 */
import { DOCK_VIEWS, type WalletView } from "./parts";

/**
 * Direction the shell is moving through the screen hierarchy.
 */
export type NavDirection = "forward" | "back" | "swap";

// Detail screens sit two levels deep, below the flows reached from a dock
// screen. Kept beside viewDepth so the depth map lives in one place.
const DETAIL_VIEWS: readonly WalletView[] = [
  "token-detail",
  "nft-detail",
  "multisig-detail",
  "multisig-propose",
  "multisig-deploy",
];

// Dock screens sit at the root (0); flows push one level deeper (1); detail
// screens deeper still (2).
const viewDepth = (view: WalletView): number =>
  DOCK_VIEWS.includes(view) ? 0 : DETAIL_VIEWS.includes(view) ? 2 : 1;

/**
 * Resolves the transition direction from the change in screen depth: deeper is
 * "forward", shallower is "back", and same-depth is a lateral "swap".
 */
export const navDirection = (from: WalletView, to: WalletView): NavDirection => {
  const delta = viewDepth(to) - viewDepth(from);
  return delta > 0 ? "forward" : delta < 0 ? "back" : "swap";
};
