/**
 * The Home VIP eligibility notice (issue 688): decided locally from the hero's
 * own complete total, dollars only, hidden once the user turns it off, and
 * never rendered without a bundled https site address (https://vip.starknet.io/).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import {
  VIP_SITE_URL,
  VIP_THRESHOLD_USD,
  vipEligible,
  vipNotice,
} from "../../../../src/sidepanel/journeys/portfolio/vip-notice";
import { bindVipNotice } from "../../../../src/sidepanel/journeys/portfolio/vip-notice-ui";
import { registerDom, status, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const SITE = "https://vip.example";
const base = {
  currency: "usd" as const,
  preferences: defaultWalletPreferences(),
  showTotal: true,
  total: VIP_THRESHOLD_USD,
};

describe("vipEligible", () => {
  test("qualifies at and above the threshold on a complete dollar total", () => {
    expect(vipEligible(base)).toBe(true);
    expect(vipEligible({ ...base, total: 250_000 })).toBe(true);
    expect(vipEligible({ ...base, preferences: null })).toBe(true);
  });

  test("never qualifies below the threshold or on a partial or unpriced total", () => {
    expect(vipEligible({ ...base, total: VIP_THRESHOLD_USD - 0.01 })).toBe(false);
    expect(vipEligible({ ...base, showTotal: false })).toBe(false);
    expect(vipEligible({ ...base, total: Number.NaN })).toBe(false);
  });

  test("never compares a euro or pound total against the dollar threshold", () => {
    expect(vipEligible({ ...base, currency: "eur", total: 1_000_000 })).toBe(false);
    expect(vipEligible({ ...base, currency: "gbp", total: 1_000_000 })).toBe(false);
  });

  test("stays off once the user turned it off", () => {
    const preferences = { ...defaultWalletPreferences(), vipNotice: false };
    expect(vipEligible({ ...base, preferences })).toBe(false);
  });
});

describe("vipNotice", () => {
  test("ships with the confirmed Starknet VIP address and renders it by default", () => {
    expect(VIP_SITE_URL).toBe("https://vip.starknet.io/");
    const html = vipNotice(true);
    expect(html).toContain('href="https://vip.starknet.io/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(vipNotice(false)).toBe("");
  });

  test("renders a link out and a dismiss control, and asks for nothing", () => {
    const html = vipNotice(true, SITE);
    expect(html).toContain("Eligible for Starknet VIP");
    expect(html).toContain(`href="${SITE}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    // Catalog text is escaped on its way into the template; it reads "Don't".
    expect(html).toContain("Don&#39;t show again");
    expect(html).not.toMatch(/<input|<form|<textarea/);
  });

  test("renders nothing when not eligible or the address is missing or not https", () => {
    expect(vipNotice(false, SITE)).toBe("");
    expect(vipNotice(true, null)).toBe("");
    expect(vipNotice(true, "http://vip.example")).toBe("");
    expect(vipNotice(true, "javascript:alert(1)")).toBe("");
  });

  test("escapes the bundled address", () => {
    expect(vipNotice(true, 'https://vip.example/"><b>')).not.toContain('"><b>');
  });
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (fails: boolean) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  document.body.append(app);
  app.innerHTML = vipNotice(true, SITE);
  const writes: unknown[] = [];
  const renders: unknown[] = [];
  bindVipNotice({
    app,
    render: async (status, reason) => {
      renders.push([status, reason]);
    },
    wallet: {
      loadStatus: async () => ({ unlocked: true }) as never,
      setDisplay: async (input) => {
        writes.push(input);
        if (fails) throw new Error("storage unavailable");
      },
    },
  });
  const hide = app.querySelector<HTMLButtonElement>("#vip-notice-hide");
  if (!hide) throw new Error("dismiss control missing");
  return { hide, renders, writes };
};

describe("bindVipNotice", () => {
  test("Don't show again turns the notice off and re-renders Home", async () => {
    const { hide, renders, writes } = mount(false);
    hide.click();
    await tick();
    await tick();
    expect(writes).toEqual([{ vipNotice: false }]);
    expect(renders).toHaveLength(1);
  });

  test("a failed write keeps the notice and re-enables the control", async () => {
    const { hide, renders, writes } = mount(true);
    hide.click();
    await tick();
    await tick();
    expect(writes).toEqual([{ vipNotice: false }]);
    expect(renders).toHaveLength(0);
    expect(hide.disabled).toBe(false);
    expect(document.querySelector("[data-vip-notice]")).not.toBeNull();
    // The toast falls back to the wallet's generic line for an unmapped error.
    expect(document.body.textContent).toContain("Something went wrong");
  });

  test("is a no-op when the notice is not on screen", () => {
    const app = document.createElement("div");
    expect(() =>
      bindVipNotice({
        app,
        render: async () => {},
        wallet: { loadStatus: async () => ({}) as never, setDisplay: async () => {} },
      }),
    ).not.toThrow();
  });
});

describe("Appearance VIP toggle", () => {
  test("is checked unless the user turned the notice off", async () => {
    const { appearanceFlow } = await import(
      "../../../../src/sidepanel/journeys/settings/settings-views"
    );
    const on = appearanceFlow(status, defaultWalletPreferences());
    const off = appearanceFlow(status, { ...defaultWalletPreferences(), vipNotice: false });
    expect(on).toMatch(/id="vip-notice-toggle"[^>]*checked|checked[^>]*id="vip-notice-toggle"/);
    expect(off).toContain('id="vip-notice-toggle"');
    expect(off).not.toMatch(
      /id="vip-notice-toggle"[^>]*checked|checked[^>]*id="vip-notice-toggle"/,
    );
  });
});
