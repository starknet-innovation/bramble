/**
 * The language screen: its choices, the settings row value, the page
 * language it applies, and the write each choice makes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { setUiLocale, uiLocale } from "../../../../src/i18n/locale";
import {
  bindLanguage,
  languageFlow,
  languageRowValue,
} from "../../../../src/sidepanel/journeys/settings/language-ui";
import type { SettingsUiDeps } from "../../../../src/sidepanel/journeys/settings/settings-ui";
import { emptyStatus, type SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { applyEntryLanguage } from "../../../../src/sidepanel/shell/entry-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
afterEach(() => {
  setUiLocale("en");
  document.body.replaceChildren();
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const prefs = (language?: "auto" | "en" | "zh-Hans") => ({
  ...defaultWalletPreferences(),
  ...(language === undefined ? {} : { language }),
});

describe("language screen", () => {
  test("offers the browser choice and each language in its own script", () => {
    const host = document.createElement("div");
    host.innerHTML = languageFlow(emptyStatus(), prefs("zh-Hans"));
    const choices = [...host.querySelectorAll<HTMLButtonElement>("[data-language]")];
    expect(
      choices.map((choice) => [choice.dataset["language"], choice.textContent?.trim()]),
    ).toEqual([
      ["auto", "Browser"],
      ["en", "English"],
      ["zh-Hans", "简体中文"],
    ]);
    expect(choices.map((choice) => choice.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
    ]);
  });

  test("an unset preference reads as following the browser", () => {
    const host = document.createElement("div");
    host.innerHTML = languageFlow(emptyStatus(), prefs());
    expect(host.querySelector('[data-language="auto"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(languageRowValue(prefs())).toBe("Browser");
    expect(languageRowValue(null)).toBe("Browser");
    expect(languageRowValue(prefs("zh-Hans"))).toBe("简体中文");
  });

  test("renders its own copy in the active language", () => {
    setUiLocale("zh-Hans");
    const host = document.createElement("div");
    host.innerHTML = languageFlow(emptyStatus(), prefs());
    expect(host.textContent).toContain("语言");
    expect(host.querySelector('[data-language="auto"]')?.textContent?.trim()).toBe("跟随浏览器");
  });
});

describe("applyEntryLanguage", () => {
  test("sets the page language and html lang from the preference", () => {
    const root = document.documentElement;
    expect(applyEntryLanguage("zh-Hans", root)).toBe("zh-Hans");
    expect(uiLocale()).toBe("zh-Hans");
    expect(root.getAttribute("lang")).toBe("zh-Hans");
    expect(applyEntryLanguage("en", root)).toBe("en");
    expect(root.getAttribute("lang")).toBe("en");
  });
});

describe("bindLanguage", () => {
  const mount = (wallet: Partial<SidepanelWallet>) => {
    const app = document.createElement("div");
    app.innerHTML = `${languageFlow(emptyStatus(), prefs("en"))}<button data-language="fr" aria-pressed="false">fr</button>`;
    document.body.append(app);
    const calls = { render: 0 };
    const deps: SettingsUiDeps = {
      app,
      expandedGroup: () => null,
      networkId: () => "SN_MAIN",
      refresh: async () => emptyStatus(),
      render: async () => {
        calls.render += 1;
      },
      setExpandedGroup: () => undefined,
      startAddAccount: () => undefined,
      wallet: wallet as SidepanelWallet,
    };
    bindLanguage(deps);
    return { app, calls };
  };

  test("writes a new choice and re-renders; ignores the pressed and unknown ones", async () => {
    const updates: unknown[] = [];
    const { app, calls } = mount({
      setDisplay: async (input) => {
        updates.push(input);
      },
    });
    app.querySelector<HTMLButtonElement>('[data-language="en"]')?.click();
    app.querySelector<HTMLButtonElement>('[data-language="fr"]')?.click();
    app.querySelector<HTMLButtonElement>('[data-language="zh-Hans"]')?.click();
    await tick();
    expect(updates).toEqual([{ language: "zh-Hans" }]);
    expect(calls.render).toBe(1);
  });

  test("a failed write re-enables the choice and does not re-render", async () => {
    const { app, calls } = mount({
      setDisplay: async () => {
        throw new Error("preferences unavailable");
      },
    });
    const choice = app.querySelector<HTMLButtonElement>('[data-language="auto"]');
    choice?.click();
    await tick();
    expect(choice?.disabled).toBe(false);
    expect(calls.render).toBe(0);
  });
});
