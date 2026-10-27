/**
 * The request-surface toolbar wiring (#690): the built-in panel click stays
 * off while the side panel is being learned, the notice commands only read and
 * clear a flag, and no approval-surface module ever opens or focuses a window.
 * The surface rules themselves are driven through the real control in
 * side-panel-learning*.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { configureApprovalSurface } from "../../../apps/extension/src/background/approvals/approval-surface";
import { handleSidePanelNoticeOps } from "../../../apps/extension/src/background/approvals/side-panel-notice-ops";

describe("toolbar configuration", () => {
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

describe("side panel notice commands", () => {
  const learner = (due: boolean) => {
    const state = { dismissed: 0, due };
    return {
      notice: {
        dismissNotice: async () => {
          state.dismissed += 1;
          state.due = false;
        },
        notice: async () => state.due,
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
