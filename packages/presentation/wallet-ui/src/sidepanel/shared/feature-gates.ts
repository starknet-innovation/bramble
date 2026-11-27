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
import type {
  ExperimentalFeatures,
  ExperimentalFeaturesState,
} from "../journeys/settings/experimental-features-runtime";
import { isParkedCollectibleView } from "./parts";

/** Effective boolean per flag key, as the background answered it. */
type FeatureFlagValues = ExperimentalFeatures["flags"];
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
  /**
   * Re-marks gated elements under the panel root; call after every render.
   * `latest` is the panel's newest Experimental features reply, if any (for
   * example right after a tester changes an override): its flags replace the
   * ones loaded at startup, so the change shows without reopening the panel.
   */
  readonly apply: (latest?: ExperimentalFeaturesState) => void;
  /** Whether `view` belongs to a gated feature that is off, or not yet known. */
  readonly hidesView: (view: string) => boolean;
  /** Whether navigation to `view` is refused: a parked collectible view, or a hidden feature's. */
  readonly blocks: (view: View, preferences: Preferences) => boolean;
};

/** Where the gate reads flags: the panel's Experimental features client. */
export type FeatureFlagSource = {
  readonly loadExperimentalFeatures: () => Promise<ExperimentalFeatures>;
};

/**
 * Loads the flags once and re-marks `root` when they arrive. Before they do,
 * and when the read fails or is refused, every gated feature is hidden.
 */
export const createFeatureGate = (
  root: ParentNode | null,
  source: FeatureFlagSource,
): FeatureGate => {
  let flags: FeatureFlagValues = {};
  const apply = (latest?: ExperimentalFeaturesState): void => {
    if (typeof latest === "object") flags = latest.flags;
    if (root) applyFeatureVisibility(root, flags);
  };
  void source.loadExperimentalFeatures().then(
    (loaded) => {
      flags = loaded.flags;
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
