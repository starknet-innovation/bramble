/**
 * The request-surface control (#690): the user's choice drives the toolbar,
 * the built-in panel click waits until the side panel is known to render, and
 * a browser that never draws it is moved to the popup through the preferences
 * store. The notice commands only read and clear a flag.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { configureApprovalSurface } from "../../../apps/extension/src/background/approvals/approval-surface";
import { createApprovalSurfaceControl } from "../../../apps/extension/src/background/approvals/approval-surface-control";
import { handleSidePanelNoticeOps } from "../../../apps/extension/src/background/approvals/side-panel-notice-ops";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 200; i += 1) await Promise.resolve();
};

const chromium = (panelRenders: boolean) => {
  const toolbar = { panel: [] as boolean[], popup: [] as string[] };
  const clicks: ((tab?: { readonly windowId?: number }) => void)[] = [];
  const browser = {
    action: {
      onClicked: {
        addListener: (listener: (tab?: { readonly windowId?: number }) => void) =>
          clicks.push(listener),
      },
      openPopup: async () => undefined,
      setPopup: async ({ popup }: { readonly popup: string }) => {
        toolbar.popup.push(popup);
      },
    },
    runtime: {
      getContexts: async () => (panelRenders && toolbar.panel.length > 1 ? [{}] : []),
      getURL: (path: string) => `chrome-extension://bramble/${path}`,
    },
    sidePanel: {
      open: async () => undefined,
      setPanelBehavior: async ({ openPanelOnActionClick }: { openPanelOnActionClick: boolean }) => {
        toolbar.panel.push(openPanelOnActionClick);
      },
    },
  };
  return { browser, clicks, toolbar };
};

describe("approval surface control", () => {
  test("hands the panel click to Chromium only once the side panel is known", async () => {
    const { browser, clicks, toolbar } = chromium(true);
    const saved: unknown[] = [];
    const control = createApprovalSurfaceControl({
      browser,
      extensionId: "bramble",
      saveSurface: async (surface) => saved.push(surface),
      store: () => createMemoryStore(),
      wait: async () => undefined,
    });
    control.bind();
    control.update("side-panel");
    await control.load();
    await flush();
    expect(toolbar.panel.at(-1)).toBe(false);
    for (const click of clicks) click({ windowId: 1 });
    await flush();
    expect(control.learner.state()).toBe("verified");
    expect(toolbar.panel.at(-1)).toBe(true);
    expect(saved).toEqual([]);
  });

  test("moves a browser that never draws the panel to the popup through preferences", async () => {
    const { browser, clicks, toolbar } = chromium(false);
    const saved: unknown[] = [];
    const control = createApprovalSurfaceControl({
      browser,
      extensionId: "bramble",
      saveSurface: async (surface) => saved.push(surface),
      store: () => createMemoryStore(),
      wait: async () => undefined,
    });
    control.bind();
    control.update("side-panel");
    await control.load();
    for (const click of clicks) click({ windowId: 1 });
    await flush();
    expect(saved).toEqual(["popup"]);
    expect(control.preference()).toBe("popup");
    expect(toolbar.popup.at(-1)).toBe("popup.html");
    expect(toolbar.panel.at(-1)).toBe(false);
  });

  test("configureApprovalSurface keeps the panel click off while learning", async () => {
    const panel: boolean[] = [];
    const browser = {
      sidePanel: {
        open: async () => undefined,
        setPanelBehavior: async ({
          openPanelOnActionClick,
        }: {
          openPanelOnActionClick: boolean;
        }) => {
          panel.push(openPanelOnActionClick);
        },
      },
    };
    await configureApprovalSurface(browser, "side-panel");
    await configureApprovalSurface(browser, "side-panel", false);
    await configureApprovalSurface(browser, "popup", true);
    expect(panel).toEqual([true, false, false]);
  });
});

describe("approval surface control: self-healing", () => {
  test("undoes its own popup switch when a real panel renders, never a user's choice", async () => {
    for (const userChoice of [false, true]) {
      const { browser, clicks } = chromium(false);
      const saved: unknown[] = [];
      let control: ReturnType<typeof createApprovalSurfaceControl> | undefined;
      control = createApprovalSurfaceControl({
        browser,
        extensionId: "bramble",
        // The preferences store reports every save back, as the adapter does.
        saveSurface: async (surface) => {
          saved.push(surface);
          control?.update(surface);
        },
        store: () => createMemoryStore(),
        wait: async () => undefined,
      });
      control.bind();
      control.apply("side-panel");
      await control.load();
      for (const click of clicks) click({ windowId: 1 });
      await flush();
      expect(control.preference()).toBe("popup");
      if (userChoice) control.update("popup");
      control.learner.observeSender({
        id: "bramble",
        url: "chrome-extension://bramble/sidepanel.html",
      });
      await flush();
      expect(saved).toEqual(userChoice ? ["popup"] : ["popup", "side-panel"]);
      expect(control.preference()).toBe(userChoice ? "popup" : "side-panel");
      expect(control.learner.state()).toBe("verified");
    }
  });
});

describe("side panel notice commands", () => {
  const learner = (due: boolean) => {
    const state = { dismissed: 0, due };
    return {
      notice: {
        dismissNotice: async () => {
          state.dismissed += 1;
          state.due = false;
        },
        notice: () => state.due,
      },
      state,
    };
  };

  test("reads and dismisses the notice", async () => {
    const { notice, state } = learner(true);
    expect(
      await handleSidePanelNoticeOps(notice, "wallet.sidePanelNotice", {
        type: "wallet.sidePanelNotice",
      }),
    ).toEqual({ notice: true, ok: true });
    expect(
      await handleSidePanelNoticeOps(notice, "wallet.dismissSidePanelNotice", {
        type: "wallet.dismissSidePanelNotice",
      }),
    ).toEqual({ ok: true });
    expect(state.dismissed).toBe(1);
    expect(
      await handleSidePanelNoticeOps(notice, "wallet.sidePanelNotice", {
        type: "wallet.sidePanelNotice",
      }),
    ).toEqual({ notice: false, ok: true });
  });

  test("is never due without a learner, refuses extra fields, and ignores other messages", async () => {
    expect(
      await handleSidePanelNoticeOps(undefined, "wallet.sidePanelNotice", {
        type: "wallet.sidePanelNotice",
      }),
    ).toEqual({ notice: false, ok: true });
    expect(
      await handleSidePanelNoticeOps(undefined, "wallet.dismissSidePanelNotice", {
        type: "wallet.dismissSidePanelNotice",
      }),
    ).toEqual({ ok: true });
    expect(
      await handleSidePanelNoticeOps(undefined, "wallet.sidePanelNotice", {
        extra: 1,
        type: "wallet.sidePanelNotice",
      }),
    ).toEqual({ error: "Invalid side panel notice request" });
    expect(
      await handleSidePanelNoticeOps(undefined, "wallet.status", { type: "wallet.status" }),
    ).toBeNull();
  });
});

describe("no fallback windows", () => {
  // #764 opened its own window when the panel failed, which could duplicate
  // a visible panel, steal focus without a gesture, and leave the window behind
  // the dapp. The surface code may only ask for the panel or the popup.
  test("the approval-surface modules never create, update or focus a window", async () => {
    for (const file of [
      "approval-surface.ts",
      "approval-surface-control.ts",
      "side-panel-learning.ts",
      "side-panel-notice-ops.ts",
    ]) {
      const source = await Bun.file(`apps/extension/src/background/approvals/${file}`).text();
      expect(source).not.toMatch(/windows\s*\??\.\s*(create|update)|focused\s*:/);
    }
  });
});
