/**
 * What a feature flag hides in the side panel. A gated element carries
 * `data-feature="<flag key>"` and stays hidden (by stylesheet, before any
 * script runs) until the gate marks it `data-feature-on`; a gated view is one
 * whose name starts with its flag's prefix, and is never navigated to while
 * the flag is off.
 *
 * Flags only ever hide shipped UI. Nothing here reaches signing, keys, RPC,
 * fees or permissions, and the background handlers behind a hidden feature
 * are unchanged. Until the flags load, and on any failure, every gated feature
 * reads as off.
 */
import type { FeatureFlagValues } from "../runtime/runtime-feature-flags";
import { isParkedCollectibleView } from "./parts";

type View = Parameters<typeof isParkedCollectibleView>[0];
type Preferences = Parameters<typeof isParkedCollectibleView>[1];

/** The screens each flag gates, by view-name prefix. */
const FEATURE_VIEW_PREFIXES: Readonly<Record<string, string>> = {
  "qsb.vaults": "qsb-",
};

/** Whether `view` belongs to a gated feature that `flags` does not turn on. */
export const isFeatureHiddenView = (view: string, flags: FeatureFlagValues): boolean =>
  Object.entries(FEATURE_VIEW_PREFIXES).some(
    ([key, prefix]) => view.startsWith(prefix) && flags[key] !== true,
  );

/** Marks each `[data-feature]` element under `root` on or off for `flags`. */
export const applyFeatureVisibility = (root: ParentNode, flags: FeatureFlagValues): void => {
  for (const element of root.querySelectorAll<HTMLElement>("[data-feature]")) {
    element.toggleAttribute("data-feature-on", flags[element.dataset["feature"] ?? ""] === true);
  }
};

/** The panel's gate: the flags as last loaded, and the two checks that read them. */
export type FeatureGate = {
  /** Re-marks gated elements under the panel root; call after every render. */
  readonly apply: () => void;
  /** Whether `view` belongs to a gated feature that is off, or not yet known. */
  readonly hidesView: (view: string) => boolean;
  /** Whether navigation to `view` is refused: a parked collectible view, or a hidden feature's. */
  readonly blocks: (view: View, preferences: Preferences) => boolean;
};

/**
 * Loads the flags once and re-marks `root` when they arrive. Before they do,
 * every gated feature is hidden.
 */
export const createFeatureGate = (
  root: ParentNode,
  load: () => Promise<FeatureFlagValues>,
): FeatureGate => {
  let flags: FeatureFlagValues = {};
  const apply = (): void => applyFeatureVisibility(root, flags);
  void load().then(
    (loaded) => {
      flags = loaded;
      apply();
    },
    () => undefined,
  );
  const hidesView = (view: string): boolean => isFeatureHiddenView(view, flags);
  return {
    apply,
    blocks: (view, preferences) => isParkedCollectibleView(view, preferences) || hidesView(view),
    hidesView,
  };
};
