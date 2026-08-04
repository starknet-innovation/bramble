/**
 * Shield stepper behavior: percentage steps with click acceleration, live
 * public/private preview, shield handoff to the deposit review, and the
 * stubbed unshield direction staying disabled.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { bindShieldSteppers } from "../../src/sidepanel/privacy-stepper";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

// Public 60, private 40, decimals 0 → total 100, base step 5.
const rowMarkup = `
  <div data-shield-row="SN_MAIN:STRK:0x1" data-shield-decimals="0" data-shield-symbol="STRK" data-shield-public="0x3c" data-shield-private-raw="0x28">
    <span data-shield-public-value="">60 STRK</span>
    <span data-shield-private="">40 STRK</span>
    <button data-shield-step="down" type="button">−</button>
    <button data-shield-step="up" type="button">+</button>
    <button data-shield-confirm type="button" hidden></button>
  </div>`;

const mount = (): {
  readonly app: HTMLElement;
  readonly clock: { now: number };
  readonly reviews: (readonly [string, string])[];
} => {
  const app = document.createElement("main");
  app.innerHTML = rowMarkup;
  document.body.append(app);
  const clock = { now: 1_000 };
  const reviews: (readonly [string, string])[] = [];
  bindShieldSteppers({
    app,
    now: () => clock.now,
    openShieldReview: (tokenId, amount) => reviews.push([tokenId, amount]),
  });
  return { app, clock, reviews };
};

const text = (app: HTMLElement, selector: string): string =>
  app.querySelector(selector)?.textContent?.trim() ?? "";

describe("shield stepper", () => {
  test("one minus click previews a five-percent shield and reveals the confirm", () => {
    const { app } = mount();
    app.querySelector<HTMLButtonElement>('[data-shield-step="down"]')?.click();

    expect(text(app, "[data-shield-public-value]")).toBe("55 STRK");
    expect(text(app, "[data-shield-private]")).toBe("45 STRK");
    const confirm = app.querySelector<HTMLButtonElement>("[data-shield-confirm]");
    expect(confirm?.hidden).toBe(false);
    expect(confirm?.textContent).toBe("Shield 5 STRK");
    expect(confirm?.disabled).toBe(false);
  });

  test("fast clicks accelerate the step and a pause resets it", () => {
    const { app, clock } = mount();
    const minus = app.querySelector<HTMLButtonElement>('[data-shield-step="down"]');
    minus?.click(); // 5% → 55
    clock.now += 200;
    minus?.click(); // 10% → 45
    clock.now += 200;
    minus?.click(); // 20% → 25
    expect(text(app, "[data-shield-public-value]")).toBe("25 STRK");

    clock.now += 5_000;
    minus?.click(); // reset to 5% → 20
    expect(text(app, "[data-shield-public-value]")).toBe("20 STRK");
  });

  test("the preview clamps at zero and at the combined total", () => {
    const { app, clock } = mount();
    const minus = app.querySelector<HTMLButtonElement>('[data-shield-step="down"]');
    for (let click = 0; click < 30; click += 1) {
      clock.now += 1_000;
      minus?.click();
    }
    expect(text(app, "[data-shield-public-value]")).toBe("0 STRK");
    expect(text(app, "[data-shield-private]")).toBe("100 STRK");
  });

  test("moving above the current public balance shows the stubbed unshield", () => {
    const { app, reviews } = mount();
    app.querySelector<HTMLButtonElement>('[data-shield-step="up"]')?.click();

    expect(text(app, "[data-shield-public-value]")).toBe("65 STRK");
    const confirm = app.querySelector<HTMLButtonElement>("[data-shield-confirm]");
    expect(confirm?.textContent).toBe("Unshield 5 STRK");
    expect(confirm?.disabled).toBe(true);
    expect(confirm?.title).toBe("Unshielding is coming soon");
    confirm?.click();
    expect(reviews).toEqual([]);
  });

  test("confirming a shield hands the exact delta to the deposit review", () => {
    const { app, clock, reviews } = mount();
    const minus = app.querySelector<HTMLButtonElement>('[data-shield-step="down"]');
    minus?.click();
    clock.now += 200;
    minus?.click(); // 55 → 45: total shielded 15
    app.querySelector<HTMLButtonElement>("[data-shield-confirm]")?.click();

    expect(reviews).toEqual([["SN_MAIN:STRK:0x1", "15"]]);
  });

  test("returning the preview to the current balance hides the confirm", () => {
    const { app, clock } = mount();
    const minus = app.querySelector<HTMLButtonElement>('[data-shield-step="down"]');
    const plus = app.querySelector<HTMLButtonElement>('[data-shield-step="up"]');
    minus?.click();
    clock.now += 5_000;
    plus?.click();

    expect(text(app, "[data-shield-public-value]")).toBe("60 STRK");
    expect(app.querySelector<HTMLButtonElement>("[data-shield-confirm]")?.hidden).toBe(true);
  });
});
