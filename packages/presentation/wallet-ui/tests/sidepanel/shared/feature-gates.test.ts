/**
 * Feature-flag gating in the side panel: gated elements and screens stay
 * hidden until the background confirms their flag is on, and any failure to
 * read the flags keeps them hidden.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFeatureFlagRuntimeClient,
  readFeatureFlagValues,
} from "../../../src/sidepanel/runtime/runtime-feature-flags";
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

const mount = (): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = gatedMarkup;
  return root;
};
const gated = (root: ParentNode): HTMLElement | null =>
  root.querySelector<HTMLElement>('[data-feature="qsb.vaults"]');

describe("reading wallet.featureFlags", () => {
  test("keeps only boolean flag values from an ok reply", () => {
    expect(
      readFeatureFlagValues({
        flags: { "qsb.vaults": true, "swap.enabled": false, "x.odd": "yes" },
        ok: true,
        sequence: 3,
        source: "remote",
      }),
    ).toEqual({ "qsb.vaults": true, "swap.enabled": false });
  });

  test("reads anything else as no flags", () => {
    for (const reply of [
      null,
      undefined,
      "ok",
      { error: "invalid feature flags request" },
      { flags: { "qsb.vaults": true }, ok: false },
      { flags: [true], ok: true },
      { ok: true },
      {
        flags: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`a.f${i}`, true])),
        ok: true,
      },
    ]) {
      expect(readFeatureFlagValues(reply)).toEqual({});
    }
  });

  test("sends a bare wallet.featureFlags request and never rejects", async () => {
    const sent: unknown[] = [];
    const client = createFeatureFlagRuntimeClient(async (message) => {
      sent.push(message);
      throw new Error("background gone");
    });
    expect(await client.loadFeatureFlags()).toEqual({});
    expect(sent).toEqual([{ type: "wallet.featureFlags" }]);
  });
});

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
    const gate = createFeatureGate(
      root,
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
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

  test("a failed load keeps every gated feature hidden", async () => {
    const root = mount();
    const gate = createFeatureGate(root, () => Promise.reject(new Error("no reply")));
    await Promise.resolve();
    await Promise.resolve();
    gate.apply();
    expect(gated(root)?.hasAttribute("data-feature-on")).toBe(false);
    expect(gate.hidesView("qsb-accounts")).toBe(true);
  });
});
