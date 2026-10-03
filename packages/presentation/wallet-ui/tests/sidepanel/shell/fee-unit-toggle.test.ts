/**
 * The tap-to-switch-unit binding.
 *
 * A reviewed fee figure is a button carrying the state it flips in
 * `aria-pressed`, and one delegated listener on the app root turns a tap on it
 * into a stored preference write plus a repaint. The interesting cases are the
 * ones a screenshot cannot show: which unit the tap actually writes, that the
 * binding is installed once however often the shell re-binds, and that a write
 * the store refuses leaves the figure tappable again rather than stuck.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SidepanelWallet } from "../../../src/sidepanel/runtime/runtime";
import { bindFeeUnitToggle } from "../../../src/sidepanel/shell/dashboard-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

beforeEach(() => {
  document.body.replaceChildren();
});

type Harness = {
  readonly app: HTMLElement;
  readonly calls: readonly (readonly unknown[])[];
  readonly renders: () => number;
  readonly wallet: SidepanelWallet;
};

const harness = (options: { readonly fail?: boolean } = {}): Harness => {
  const app = document.createElement("div");
  document.body.append(app);
  const calls: unknown[][] = [];
  const renders = 0;
  const wallet = {
    async loadStatus() {
      return { locked: false };
    },
    async setDisplay(input: unknown) {
      calls.push([input]);
      if (options.fail === true) {
        throw new Error("store unavailable");
      }
    },
  } as unknown as SidepanelWallet;
  return {
    app,
    calls,
    renders: () => renders,
    wallet: {
      ...wallet,
      loadStatus: wallet.loadStatus,
    },
  } as Harness;
};

/** A rendered fee figure in the given pressed state, mounted under the app root. */
const toggle = (app: HTMLElement, showingFiat: boolean): HTMLButtonElement => {
  const row = document.createElement("p");
  row.className = "review-fee";
  row.innerHTML = `Estimated fee: <button type="button" class="fee-unit-toggle" data-fee-toggle aria-pressed="${String(showingFiat)}">figure</button>`;
  app.replaceChildren(row);
  const button = row.querySelector<HTMLButtonElement>("[data-fee-toggle]");
  if (!button) {
    throw new Error("Missing fee toggle");
  }
  return button;
};

const binding = (h: Harness): void =>
  bindFeeUnitToggle({
    app: h.app,
    render: async () => {
      // The repaint is a no-op here: the assertion is on what was asked for.
    },
    wallet: h.wallet,
  });

describe("bindFeeUnitToggle", () => {
  test("a tap on the STRK figure stores the fiat reading", async () => {
    const h = harness();
    binding(h);
    toggle(h.app, false).click();
    await Bun.sleep(0);
    expect(h.calls).toEqual([[{ feeDisplayUnit: "fiat" }]]);
  });

  test("a tap on the fiat figure stores the exact STRK reading", async () => {
    const h = harness();
    binding(h);
    toggle(h.app, true).click();
    await Bun.sleep(0);
    expect(h.calls).toEqual([[{ feeDisplayUnit: "strk" }]]);
  });

  test("re-binding the shell does not double the write", async () => {
    const h = harness();
    binding(h);
    binding(h);
    toggle(h.app, false).click();
    await Bun.sleep(0);
    expect(h.calls).toHaveLength(1);
  });

  test("a refused write leaves the figure tappable again", async () => {
    const h = harness({ fail: true });
    binding(h);
    const button = toggle(h.app, false);
    button.click();
    await Bun.sleep(0);
    expect(button.disabled).toBe(false);
    expect(h.calls).toHaveLength(1);
  });

  test("a click outside any fee figure writes nothing", async () => {
    const h = harness();
    binding(h);
    const elsewhere = document.createElement("p");
    elsewhere.textContent = "Nothing to switch here";
    h.app.replaceChildren(elsewhere);
    elsewhere.click();
    await Bun.sleep(0);
    expect(h.calls).toHaveLength(0);
  });

  test("binds nothing when the shell has no root yet", () => {
    expect(() =>
      bindFeeUnitToggle({ app: null, render: async () => undefined, wallet: harness().wallet }),
    ).not.toThrow();
  });
});
