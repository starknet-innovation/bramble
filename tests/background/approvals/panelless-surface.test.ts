/**
 * A browser with no panel API (Safari has neither `sidePanel` nor
 * `sidebarAction`) is served the popup whatever the stored choice. Without
 * this, the default "side-panel" choice clears the toolbar popup and a click on
 * the toolbar button opens nothing at all.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import {
  type ApprovalSurfaceControlBrowser,
  createApprovalSurfaceControl,
} from "../../../apps/extension/src/background/approvals/approval-surface-control";

const browserWith = (panel: "none" | "sidebar") => {
  const popups: string[] = [];
  const browser: ApprovalSurfaceControlBrowser = {
    action: {
      onClicked: { addListener: () => undefined },
      setPopup: async ({ popup }) => {
        popups.push(popup);
      },
    },
    ...(panel === "sidebar" ? { sidebarAction: { open: () => Promise.resolve() } } : {}),
  };
  return { browser, popups };
};

const started = async (panel: "none" | "sidebar", stored: "popup" | "side-panel") => {
  const { browser, popups } = browserWith(panel);
  const store = createMemoryStore();
  const control = createApprovalSurfaceControl({
    approvals: () => [],
    browser,
    extensionId: "bramble",
    now: () => 0,
    store: () => store,
    wait: () => Promise.resolve(),
  });
  control.bind();
  await control.start(Promise.resolve(stored));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { control, popups };
};

describe("a browser with no panel API", () => {
  test("serves the stored side-panel choice as the popup", async () => {
    const { control, popups } = await started("none", "side-panel");
    expect(control.preference()).toBe("side-panel");
    expect(control.effective()).toBe("popup");
    expect(popups.at(-1)).toBe("popup.html");
  });

  test("keeps serving the popup when the user picks the side panel", async () => {
    const { control, popups } = await started("none", "popup");
    control.update("side-panel");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(control.effective()).toBe("popup");
    expect(popups.at(-1)).toBe("popup.html");
  });

  test("a browser with Firefox's sidebar still gets the side-panel choice", async () => {
    const { control, popups } = await started("sidebar", "side-panel");
    expect(control.effective()).toBe("side-panel");
    expect(popups.at(-1)).toBe("");
  });
});
