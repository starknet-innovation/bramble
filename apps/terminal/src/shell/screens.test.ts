import { describe, expect, it } from "vitest";
import { TOKEN_CREATE_ENABLED } from "../protocols/constants";
import { SCREEN_TABS, screenFromHash, screenTabs } from "./screens";

describe("screenFromHash", () => {
  it("opens the portfolio workspace from the wallet deep link", () => {
    expect(screenFromHash("#portfolio")).toBe("portfolio");
  });

  it("fails closed to Discover for missing or unknown screens", () => {
    expect(screenFromHash("")).toBe("discover");
    expect(screenFromHash("#unknown")).toBe("discover");
  });
});

describe("Create gate", () => {
  it("hides the Create tab and its hash while the gate is off", () => {
    const tabs = screenTabs({ create: false });
    expect(tabs.map((tab) => tab.id)).not.toContain("create");
    expect(screenFromHash("#create", tabs)).toBe("discover");
  });

  it("shows Create before Portfolio once the gate is on", () => {
    const tabs = screenTabs({ create: true });
    expect(tabs.map((tab) => tab.id).slice(-2)).toEqual(["create", "portfolio"]);
    expect(screenFromHash("#create", tabs)).toBe("create");
  });

  it("ships with the gate off", () => {
    expect(SCREEN_TABS.map((tab) => tab.id)).not.toContain("create");
    expect(TOKEN_CREATE_ENABLED).toBe(false);
  });
});
