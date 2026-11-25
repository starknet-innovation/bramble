/**
 * The side panel's scene renderer with its feature gate attached: after every
 * scene render (when the screen's bindings run), gated `[data-feature]`
 * elements are re-marked from the newest flag values, which are the panel's
 * latest Experimental features reply when it has one, otherwise the flags the
 * gate loaded at startup.
 *
 * Split out of `start.ts` so that file stays within the size budget. The gate
 * only ever hides UI; see `shared/feature-gates.ts`.
 */
import type { ExperimentalFeaturesState } from "../../journeys/settings/experimental-features-runtime";
import {
  createFeatureGate,
  type FeatureFlagSource,
  type FeatureGate,
} from "../../shared/feature-gates";
import { createSceneRenderer } from "./scene-renderer";

/**
 * Creates the gate and the scene renderer over `app`. `bind` runs after each
 * render, then the gate re-marks from `cache.experimentalFeatures` as it is
 * at that moment.
 */
export const createGatedScenes = (
  app: Element | null,
  source: FeatureFlagSource,
  cache: { readonly experimentalFeatures: ExperimentalFeaturesState },
  bind: () => void,
): {
  readonly features: FeatureGate;
  readonly renderScene: ReturnType<typeof createSceneRenderer>;
} => {
  const features = createFeatureGate(app, source);
  const renderScene = createSceneRenderer(app, () => {
    bind();
    features.apply(cache.experimentalFeatures);
  });
  return { features, renderScene };
};
