/**
 * Safari has no wallet panel, so the request-display choice (side panel or
 * popup) would be offered there and then ignored: the background serves the
 * popup whatever is chosen. The UI marks such a browser and hides the choice.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { settingsScreen } from "../../../src/sidepanel/journeys/settings/settings-views";
import { markPanelSupport, PANELLESS_BROWSER_CLASS } from "../../../src/sidepanel/shared/dom";
import { SIDEPANEL_STYLES } from "../../../src/sidepanel/styles/index";
import { registerDom, status, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
afterEach(() => {
  document.body.className = "";
});

describe("panel support", () => {
  test("marks a browser with neither sidePanel nor sidebarAction", () => {
    markPanelSupport({});
    expect(document.body.classList.contains(PANELLESS_BROWSER_CLASS)).toBe(true);
  });

  test("leaves Chromium and Firefox unmarked", () => {
    markPanelSupport({ sidePanel: {} });
    expect(document.body.classList.contains(PANELLESS_BROWSER_CLASS)).toBe(false);
    markPanelSupport({ sidebarAction: {} });
    expect(document.body.classList.contains(PANELLESS_BROWSER_CLASS)).toBe(false);
  });

  test("marks nothing without a browser API (tests, UI Lab)", () => {
    markPanelSupport(undefined);
    expect(document.body.classList.contains(PANELLESS_BROWSER_CLASS)).toBe(false);
  });

  test("the request-display row is the panel-only control, and the mark hides it", () => {
    const markup = settingsScreen(status, {} as WalletPreferences);
    expect(markup).toMatch(/data-requires-panel[^>]*data-view="request-settings"/);
    expect(SIDEPANEL_STYLES).toContain(
      `body.${PANELLESS_BROWSER_CLASS} [data-requires-panel] { display: none; }`,
    );
  });
});
