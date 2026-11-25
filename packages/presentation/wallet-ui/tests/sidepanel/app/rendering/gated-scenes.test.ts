/**
 * The scene renderer with the feature gate attached: each render runs the
 * screen's bindings, then re-marks gated elements from the newest flags.
 */
import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createGatedScenes } from "../../../../src/sidepanel/app/rendering/gated-scenes";
import type { ExperimentalFeaturesState } from "../../../../src/sidepanel/journeys/settings/experimental-features-runtime";

const reply = (flags: Record<string, boolean>): ExperimentalFeaturesState => ({
  flags,
  killed: [],
  overridable: ["qsb.vaults"],
  overridden: [],
});

test("each render binds, then marks gated elements from the newest flags", async () => {
  GlobalRegistrator.register();
  try {
    const mount = document.createElement("main");
    document.body.append(mount);
    const cache: { experimentalFeatures: ExperimentalFeaturesState } = {
      experimentalFeatures: "loading",
    };
    let bindings = 0;
    const { features, renderScene } = createGatedScenes(
      mount,
      { loadExperimentalFeatures: () => Promise.reject(new Error("not yet")) },
      cache,
      () => {
        bindings += 1;
      },
    );
    const gated = () => mount.querySelector('[data-feature="qsb.vaults"]');
    renderScene('<button data-feature="qsb.vaults">QSB vaults</button>', false, "forward");
    expect(bindings).toBe(1);
    expect(gated()?.hasAttribute("data-feature-on")).toBe(false);
    expect(features.hidesView("qsb-accounts")).toBe(true);

    // A tester turns the override on; the next render picks it up.
    cache.experimentalFeatures = reply({ "qsb.vaults": true });
    renderScene('<button data-feature="qsb.vaults">QSB vaults </button>', false, "forward");
    expect(bindings).toBe(2);
    expect(gated()?.hasAttribute("data-feature-on")).toBe(true);
    expect(features.hidesView("qsb-accounts")).toBe(false);
  } finally {
    await GlobalRegistrator.unregister();
  }
});
