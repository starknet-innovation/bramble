/**
 * The one-time "opens as a popup" notice (issue 690): shown only in the
 * popup, only when the background says it is due, and dismissed for good.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createSidePanelNoticeClient,
  SIDE_PANEL_NOTICE_BODY,
  SIDE_PANEL_NOTICE_DISMISS,
  SIDE_PANEL_NOTICE_TITLE,
  startSidePanelNotice,
} from "../../../src/sidepanel/shell/side-panel-notice";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
  document.body.className = "";
});

const notice = (due: boolean) => {
  const dismissed: number[] = [];
  return {
    client: {
      dismissSidePanelNotice: async () => {
        dismissed.push(1);
      },
      sidePanelNoticeDue: async () => due,
    },
    dismissed,
  };
};

describe("side panel notice", () => {
  test("shows once in the popup when due, and dismissing removes it for good", async () => {
    document.body.classList.add("popup-surface");
    const { client, dismissed } = notice(true);
    await startSidePanelNotice({ doc: document, notice: client });
    await startSidePanelNotice({ doc: document, notice: client });
    const shown = document.querySelectorAll("#side-panel-notice");
    expect(shown).toHaveLength(1);
    expect(shown[0]?.textContent).toContain(SIDE_PANEL_NOTICE_TITLE);
    expect(shown[0]?.textContent).toContain(SIDE_PANEL_NOTICE_BODY);
    const button = shown[0]?.querySelector("button");
    expect(button?.textContent).toBe(SIDE_PANEL_NOTICE_DISMISS);
    button?.click();
    expect(document.querySelector("#side-panel-notice")).toBeNull();
    expect(dismissed).toEqual([1]);
  });

  test("never shows in the side panel or tab, or when not due", async () => {
    await startSidePanelNotice({ doc: document, notice: notice(true).client });
    expect(document.querySelector("#side-panel-notice")).toBeNull();
    document.body.classList.add("popup-surface");
    await startSidePanelNotice({ doc: document, notice: notice(false).client });
    expect(document.querySelector("#side-panel-notice")).toBeNull();
  });

  test("the client reads only an exact due answer and never throws", async () => {
    const sent: unknown[] = [];
    const answering = (response: unknown) =>
      createSidePanelNoticeClient(async (message) => {
        sent.push(message);
        return response;
      });
    expect(await answering({ notice: true, ok: true }).sidePanelNoticeDue()).toBe(true);
    expect(await answering({ notice: false, ok: true }).sidePanelNoticeDue()).toBe(false);
    expect(await answering({ extra: 1, notice: true, ok: true }).sidePanelNoticeDue()).toBe(false);
    expect(await answering({ error: "x" }).sidePanelNoticeDue()).toBe(false);
    const failing = createSidePanelNoticeClient(async () => {
      throw new Error("worker gone");
    });
    expect(await failing.sidePanelNoticeDue()).toBe(false);
    await failing.dismissSidePanelNotice();
    await answering({ ok: true }).dismissSidePanelNotice();
    expect(sent).toContainEqual({ type: "wallet.sidePanelNotice" });
    expect(sent).toContainEqual({ type: "wallet.dismissSidePanelNotice" });
  });
});
