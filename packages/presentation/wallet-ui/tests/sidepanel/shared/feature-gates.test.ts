/**
 * Feature-flag gating in the side panel: gated elements and screens stay
 * hidden until the background confirms their flag is on, and any failure to
 * read the flags keeps them hidden. Reading and validating the reply is the
 * Experimental features client's job (tested with it).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  applyFeatureVisibility,
  createFeatureGate,
  isFeatureHiddenView,
} from "../../../src/sidepanel/shared/feature-gates";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const gatedMarkup = `<div>
  <button data-feature="qsb.vaults" data-view="qsb-accounts">QSB vaults</button>
  <button data-view="account">Manage accounts</button>
</div>`;

// A validated Experimental features reply carrying `flags`.
const features = (flags: Record<string, boolean>) => ({
  flags,
  killed: [],
  overridable: [],
  overridden: [],
});

const mount = (): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = gatedMarkup;
  return root;
};
const gated = (root: ParentNode): HTMLElement | null =>
  root.querySelector<HTMLElement>('[data-feature="qsb.vaults"]');

describe("gating", () => {
  test("a gated view is hidden unless its flag is exactly true", () => {
    for (const view of ["qsb-accounts", "qsb-account", "qsb-deposit", "qsb-release"]) {
      expect(isFeatureHiddenView(view, {})).toBe(true);
      expect(isFeatureHiddenView(view, { "qsb.vaults": false })).toBe(true);
      expect(isFeatureHiddenView(view, { "qsb.vaults": true })).toBe(false);
    }
    expect(isFeatureHiddenView("home", {})).toBe(false);
    expect(isFeatureHiddenView("account", {})).toBe(false);
  });

  test("marks gated elements on only for a true flag, and leaves the rest alone", () => {
    const root = mount();
    applyFeatureVisibility(root, {});
    expect(gated(root)?.hasAttribute("data-feature-on")).toBe(false);
    applyFeatureVisibility(root, { "qsb.vaults": true });
    expect(gated(root)?.hasAttribute("data-feature-on")).toBe(true);
    applyFeatureVisibility(root, { "qsb.vaults": false });
    expect(gated(root)?.hasAttribute("data-feature-on")).toBe(false);
    expect(root.querySelector('[data-view="account"]')?.hasAttribute("data-feature-on")).toBe(
      false,
    );
  });

  test("the gate hides everything until the flags load, then applies them", async () => {
    const root = mount();
    let answer: (flags: Record<string, boolean>) => void = () => undefined;
    const gate = createFeatureGate(root, {
      loadExperimentalFeatures: () =>
        new Promise<Record<string, boolean>>((resolve) => {
          answer = resolve;
        }).then(features),
    });
    gate.apply();
    expect(gated(root)?.hasAttribute("data-feature-on")).toBe(false);
    expect(gate.hidesView("qsb-accounts")).toBe(true);
    answer({ "qsb.vaults": true });
    await Promise.resolve();
    await Promise.resolve();
    expect(gated(root)?.hasAttribute("data-feature-on")).toBe(true);
    expect(gate.hidesView("qsb-accounts")).toBe(false);
    expect(gate.blocks("home", null)).toBe(false);
  });

  test("a newer Experimental features reply replaces the startup flags", async () => {
    const root = mount();
    const gate = createFeatureGate(root, {
      loadExperimentalFeatures: async () => features({ "qsb.vaults": false }),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.hidesView("qsb-accounts")).toBe(true);
    // A tester turns the override on; the panel re-renders with the new reply.
    gate.apply({ ...features({ "qsb.vaults": true }), overridden: ["qsb.vaults"] });
    expect(gated(root)?.hasAttribute("data-feature-on")).toBe(true);
    expect(gate.hidesView("qsb-accounts")).toBe(false);
    // Loading and error states carry no flags, so they keep the last known ones.
    gate.apply("loading");
    gate.apply("error");
    expect(gate.hidesView("qsb-accounts")).toBe(false);
    // A remote hard kill comes back as the flag off, and hides it again.
    gate.apply({ ...features({ "qsb.vaults": false }), killed: ["qsb.vaults"] });
    expect(gated(root)?.hasAttribute("data-feature-on")).toBe(false);
    expect(gate.hidesView("qsb-accounts")).toBe(true);
  });

  test("a failed load keeps every gated feature hidden", async () => {
    const root = mount();
    const gate = createFeatureGate(root, {
      loadExperimentalFeatures: () => Promise.reject(new Error("feature flags unavailable")),
    });
    await Promise.resolve();
    await Promise.resolve();
    gate.apply();
    expect(gated(root)?.hasAttribute("data-feature-on")).toBe(false);
    expect(gate.hidesView("qsb-accounts")).toBe(true);
  });
});
