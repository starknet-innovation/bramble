/**
 * The rescue for a dapp-triggered side panel open Chrome refused (#707): the
 * gesture expired, so the toolbar popup is opened instead unless a side panel
 * is already open in that window. No window, no focus, no write, never the
 * side-panel learner, and throttled across tabs.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { DEFAULT_ORIGIN_GUARD } from "@bramble/permissions/blocklist";
import type { ApprovalSurfacePreference } from "@bramble/settings/preferences";
import { createApprovalSurfaceOpener } from "../../../apps/extension/src/background/approvals/approval-surface";
import {
  createSurfaceRescue,
  SURFACE_RESCUE_THROTTLE_MS,
} from "../../../apps/extension/src/background/approvals/approval-surface-rescue";
import { settleAll } from "../../support/side-panel-learning-harness";

const ORIGIN = "https://dapp.example";
const request = (extra: Record<string, unknown> = {}) => ({
  origin: ORIGIN,
  type: "wallet.requestAccounts",
  ...extra,
});
const fromTab = (tabId: number, windowId = 7) => ({
  id: "extension-id",
  tab: { id: tabId, windowId },
  url: `${ORIGIN}/app`,
});

type Options = {
  readonly blocked?: boolean;
  readonly contexts?: readonly unknown[] | "fail";
  readonly firefox?: boolean;
  readonly openRejects?: boolean;
  readonly popupRejects?: boolean;
  readonly preference?: ApprovalSurfacePreference;
};

const chromium = (options: Options = {}) => {
  const calls = { panels: [] as number[], popups: [] as unknown[], sidebars: 0 };
  let clock = 0;
  const browser = {
    action: {
      openPopup: async (popup?: { readonly windowId?: number }) => {
        calls.popups.push(popup);
        if (options.popupRejects) throw new Error("no gesture");
      },
    },
    runtime: {
      getContexts: async () => {
        if (options.contexts === "fail") throw new Error("unavailable");
        return options.contexts ?? [];
      },
    },
    ...(options.firefox
      ? {
          sidebarAction: {
            open: async () => {
              calls.sidebars += 1;
              throw new Error("needs a user action");
            },
          },
        }
      : {
          sidePanel: {
            open: async ({ tabId }: { readonly tabId: number }) => {
              calls.panels.push(tabId);
              if (options.openRejects ?? true) throw new Error("gesture expired");
            },
          },
        }),
  };
  const now = () => clock;
  const open = createApprovalSurfaceOpener({
    browser,
    extensionId: "extension-id",
    guard: options.blocked
      ? { ...DEFAULT_ORIGIN_GUARD, isBlocked: () => true }
      : DEFAULT_ORIGIN_GUARD,
    now,
    preference: () => options.preference ?? "side-panel",
    rescue: createSurfaceRescue({
      browser,
      now,
      showPopup: (windowId) => browser.action.openPopup({ windowId }),
    }),
  });
  return {
    calls,
    open,
    tick: (ms: number) => {
      clock += ms;
    },
  };
};

describe("rescuing a refused side panel open", () => {
  test("opens the popup in that window when no side panel is open", async () => {
    const run = chromium();
    run.open(request(), fromTab(42));
    await settleAll();
    expect(run.calls.panels).toEqual([42]);
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
  });

  test("does nothing more when a side panel is already open in that window", async () => {
    const run = chromium({ contexts: [{ contextType: "SIDE_PANEL", windowId: 7 }] });
    run.open(request(), fromTab(42));
    await settleAll();
    expect(run.calls.popups).toEqual([]);
    // A panel in another window doesn't count.
    const other = chromium({ contexts: [{ contextType: "SIDE_PANEL", windowId: 9 }] });
    other.open(request(), fromTab(42));
    await settleAll();
    expect(other.calls.popups).toEqual([{ windowId: 7 }]);
  });

  test("a refused popup leaves the badge, and nothing throws", async () => {
    const run = chromium({ popupRejects: true });
    run.open(request(), fromTab(42));
    await settleAll();
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
    const rescue = createSurfaceRescue({
      browser: { sidePanel: {} },
      now: () => 0,
      showPopup: async () => {
        throw new Error("refused");
      },
    });
    await expect(rescue(7)).resolves.toBeUndefined();
  });

  test("never runs for an open that succeeded, a gated or silent request, or a cooling tab", async () => {
    const opened = chromium({ openRejects: false });
    opened.open(request(), fromTab(42));
    await settleAll();
    expect(opened.calls.popups).toEqual([]);
    const blocked = chromium({ blocked: true });
    blocked.open(request(), fromTab(42));
    await settleAll();
    expect(blocked.calls).toEqual({ panels: [], popups: [], sidebars: 0 });
    const run = chromium();
    run.open(request({ silent: true }), fromTab(42));
    run.open(request(), { id: "extension-id", url: `${ORIGIN}/app` } as never);
    await settleAll();
    expect(run.calls.popups).toEqual([]);
    // The per-tab cooldown stops a second request before the panel is tried.
    run.open(request(), fromTab(42));
    run.open(request(), fromTab(42));
    await settleAll();
    expect(run.calls.panels).toEqual([42]);
    expect(run.calls.popups).toHaveLength(1);
  });

  test("is throttled across tabs", async () => {
    const run = chromium();
    run.open(request(), fromTab(1));
    run.open(request(), fromTab(2));
    await settleAll();
    expect(run.calls.panels).toEqual([1, 2]);
    expect(run.calls.popups).toHaveLength(1);
    run.tick(SURFACE_RESCUE_THROTTLE_MS - 1);
    run.open(request(), fromTab(3));
    await settleAll();
    expect(run.calls.popups).toHaveLength(1);
    run.tick(1);
    run.open(request(), fromTab(4));
    await settleAll();
    expect(run.calls.popups).toHaveLength(2);
  });

  test("follows the popup preference's own fallback: popup, then panel, then rescue", async () => {
    const run = chromium({ popupRejects: true, preference: "popup" });
    run.open(request(), fromTab(42));
    await settleAll();
    expect(run.calls.panels).toEqual([42]);
    expect(run.calls.popups).toEqual([{ windowId: 7 }, { windowId: 7 }]);
  });

  test("is inert on Firefox, and with no window to name", async () => {
    const run = chromium({ firefox: true });
    run.open(request(), fromTab(42));
    await settleAll();
    expect(run.calls.sidebars).toBe(1);
    expect(run.calls.popups).toEqual([]);
    const noWindow = chromium();
    noWindow.open(request(), { id: "extension-id", tab: { id: 42 }, url: `${ORIGIN}/app` });
    await settleAll();
    expect(noWindow.calls.popups).toEqual([]);
  });

  test("a failed context query still opens the popup", async () => {
    const run = chromium({ contexts: "fail" });
    run.open(request(), fromTab(42));
    await settleAll();
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
  });

  test("writes nothing and never reaches the side-panel learner", async () => {
    const source = await readFile(
      "apps/extension/src/background/approvals/approval-surface-rescue.ts",
      "utf8",
    );
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(imports).toEqual(["@bramble/core/json"]);
    expect(source).not.toMatch(/\.set\(|setDisplay|storage|learner\./);
    // The background wires the control's rescue, built from the browser,
    // the clock and the control's popup opener only.
    const entry = await readFile("apps/extension/src/background/index.ts", "utf8");
    expect(entry).toContain("rescue: approvalSurface.rescue,");
    const control = await readFile(
      "apps/extension/src/background/approvals/approval-surface-control.ts",
      "utf8",
    );
    expect(control).toContain("rescue: createSurfaceRescue({ browser, now, showPopup }),");
  });
});
