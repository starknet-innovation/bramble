/**
 * The compose card survives the repaints that happen inside its own flow.
 * Picking a withdrawal destination, or deriving a fresh account, rebuilds the
 * whole card; without mirroring the composed direction and amount into journey
 * state the user is thrown back to an empty "Shield" mid-unshield.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { bindComposeCard } from "../../src/sidepanel/privacy-compose-ui";
import type { PrivacyJourneyState } from "../../src/sidepanel/privacy-model";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

// The card as the view renders it: always public-on-top, with the direction and
// the balances carried on the form for the bindings to swap.
const CARD = `
  <div class="flow-title"><h1>Shield</h1></div>
  <form id="privacy-deposit-form" data-direction="shield"
    data-symbol="STRK" data-decimals="18" data-token-address="0x4718"
    data-public-balance="5000000000000000000" data-private-balance-raw="20000000000000000000"
    data-public-formatted="5" data-private-formatted="20">
    <p data-privacy-side-label="source">Public balance</p>
    <span data-privacy-side-balance="source">5</span>
    <p data-privacy-side-label="destination">Private balance</p>
    <span data-privacy-side-balance="destination">20</span>
    <input id="privacy-amount" name="amount" value="">
    <output id="privacy-result-amount">0</output>
    <button id="privacy-flip" type="button">flip</button>
    <button id="privacy-review-submit" type="submit">Review shielding</button>
    <div data-privacy-recipient-row hidden></div>
    <p data-privacy-fee></p>
  </form>`;

const mount = (): HTMLElement => {
  const app = document.createElement("main");
  app.innerHTML = CARD;
  document.body.append(app);
  return app;
};

// A paint: the card is rebuilt from the view, then re-bound against the journey
// state that survived — exactly what deps.paint() does in the real panel.
const repaint = (state: { journey: PrivacyJourneyState }): HTMLElement => {
  const held = state;
  document.body.replaceChildren();
  const app = mount();
  bindComposeCard({
    app,
    journey: () => held.journey,
    setJourney: (next) => {
      held.journey = next;
    },
  });
  return app;
};

const el = <T extends Element>(app: HTMLElement, selector: string): T => {
  const node = app.querySelector<T>(selector);
  if (!node) {
    throw new Error(`missing ${selector}`);
  }
  return node;
};

const sourceLabel = (app: HTMLElement): string =>
  el(app, '[data-privacy-side-label="source"]').textContent ?? "";

describe("compose card state across repaints", () => {
  test("picking a destination keeps private on top and the amount intact", () => {
    const state: { journey: PrivacyJourneyState } = {
      journey: { stage: "compose", tokenId: "SN_MAIN:STRK:0x4718" },
    };
    const app = repaint(state);

    // Flip to unshield and type an amount, as the user does before choosing
    // where the withdrawal should land.
    el<HTMLButtonElement>(app, "#privacy-flip").click();
    const input = el<HTMLInputElement>(app, "#privacy-amount");
    input.value = "12";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));

    expect(sourceLabel(app)).toBe("Private balance");
    expect(el(app, '[data-privacy-side-balance="source"]').textContent).toBe("20");
    expect(el(app, "[data-privacy-recipient-row]").hasAttribute("hidden")).toBe(false);

    // Both are now durable, so the destination pick's repaint can restore them.
    expect(state.journey).toEqual({
      amount: "12",
      stage: "compose",
      tokenId: "SN_MAIN:STRK:0x4718",
      unshielding: true,
    });

    // The repaint a destination pick triggers.
    state.journey = { ...state.journey, destinationAccountId: "SN_MAIN:0xpanda" } as never;
    const after = repaint(state);

    expect(sourceLabel(after)).toBe("Private balance");
    expect(el<HTMLInputElement>(after, "#privacy-amount").value).toBe("12");
    expect(el(after, "#privacy-review-submit").textContent).toBe("Review unshielding");
    expect(el(after, "[data-privacy-recipient-row]").hasAttribute("hidden")).toBe(false);
    expect(after.ownerDocument.querySelector(".flow-title h1")?.textContent).toBe("Unshield");
    // The projection was recomputed from the restored amount, not from zero.
    expect(el(after, "#privacy-result-amount").textContent).toBe("12");
  });

  test("a shield-direction card restores as shield with its amount", () => {
    const state: { journey: PrivacyJourneyState } = {
      journey: { amount: "3", stage: "compose", tokenId: "t" },
    };
    const after = repaint(state);

    expect(sourceLabel(after)).toBe("Public balance");
    expect(el<HTMLInputElement>(after, "#privacy-amount").value).toBe("3");
    expect(el(after, "[data-privacy-recipient-row]").hasAttribute("hidden")).toBe(true);
  });

  test("flipping back to shield is remembered too", () => {
    const state: { journey: PrivacyJourneyState } = {
      journey: { amount: "1", stage: "compose", tokenId: "t", unshielding: true },
    };
    const app = repaint(state);
    expect(sourceLabel(app)).toBe("Private balance");

    el<HTMLButtonElement>(app, "#privacy-flip").click();

    expect(state.journey).toEqual({
      amount: "1",
      stage: "compose",
      tokenId: "t",
      unshielding: false,
    });
    expect(sourceLabel(repaint(state))).toBe("Public balance");
  });

  test("composed fields are never written onto another journey stage", () => {
    const state: { journey: PrivacyJourneyState } = { journey: { stage: "idle" } };
    const app = mount();
    bindComposeCard({
      app,
      journey: () => state.journey,
      setJourney: (next) => {
        state.journey = next;
      },
    });

    el<HTMLButtonElement>(app, "#privacy-flip").click();
    const input = el<HTMLInputElement>(app, "#privacy-amount");
    input.value = "5";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));

    expect(state.journey).toEqual({ stage: "idle" });
  });
});
