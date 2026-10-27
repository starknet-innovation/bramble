/**
 * The rescue for a dapp-triggered side panel open Chrome refused (#707): the
 * gesture expired, so the toolbar popup is opened instead, but only for a
 * request the wallet accepted and still holds, unless a side panel is already
 * open in that window. One at a time, throttled across tabs when it would
 * open. No window, no focus, no write, never the side-panel learner.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { DEFAULT_ORIGIN_GUARD } from "@bramble/permissions/blocklist";
import type { ApprovalSurfacePreference } from "@bramble/settings/preferences";
import { createApprovalSurfaceOpener } from "../../../apps/extension/src/background/approvals/approval-surface";
import {
  createSurfaceRescue,
  type RescueApproval,
  SURFACE_RESCUE_ACCEPT_MS,
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
  /** The request queues no approval (refused, or none needed). */
  readonly noApproval?: boolean;
  readonly openRejects?: boolean;
  readonly popupRejects?: boolean;
  readonly preference?: ApprovalSurfacePreference;
};

const gate = () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
};

const chromium = (options: Options = {}) => {
  const calls = {
    lookups: 0,
    panels: [] as number[],
    popups: [] as unknown[],
    sidebars: 0,
    waits: 0,
  };
  let clock = 0;
  let next = 0;
  const approvals: RescueApproval[] = [{ id: "earlier", origin: ORIGIN }];
  let lookup: Promise<void> | null = null;
  const browser = {
    action: {
      openPopup: async (popup?: { readonly windowId?: number }) => {
        calls.popups.push(popup);
        if (options.popupRejects) throw new Error("no gesture");
      },
    },
    runtime: {
      getContexts: async () => {
        calls.lookups += 1;
        if (lookup) await lookup;
        if (options.contexts === "fail") throw new Error("unavailable");
        return options.contexts ?? [];
      },
    },
    ...(options.firefox
      ? {
          sidebarAction: {
            open: async () => {
              calls.sidebars += 1;
              next += 1;
              approvals.push({ id: `a${next}`, origin: ORIGIN });
              throw new Error("needs a user action");
            },
          },
        }
      : {
          sidePanel: {
            open: async ({ tabId }: { readonly tabId: number }) => {
              calls.panels.push(tabId);
              // The request's own handling queues its approval meanwhile.
              if (!options.noApproval) {
                next += 1;
                approvals.push({ id: `a${next}`, origin: ORIGIN });
              }
              if (options.openRejects ?? true) throw new Error("gesture expired");
            },
          },
        }),
  };
  const now = () => clock;
  const rescue = createSurfaceRescue({
    approvals: () => approvals,
    browser,
    now,
    showPopup: async (windowId, admit) => {
      if (!admit()) return;
      await browser.action.openPopup({ windowId });
    },
    wait: async () => {
      calls.waits += 1;
    },
  });
  const open = createApprovalSurfaceOpener({
    browser,
    extensionId: "extension-id",
    guard: options.blocked
      ? { ...DEFAULT_ORIGIN_GUARD, isBlocked: () => true }
      : DEFAULT_ORIGIN_GUARD,
    now,
    preference: () => options.preference ?? "side-panel",
    rescue,
  });
  return {
    approvals,
    calls,
    /** Holds the side panel context lookup until released. */
    holdLookup: () => {
      const { held, release } = gate();
      lookup = held;
      return () => {
        lookup = null;
        release();
      };
    },
    open,
    tick: (ms: number) => {
      clock += ms;
    },
  };
};

describe("rescuing a refused side panel open", () => {
  test("opens the popup in that window for an accepted request", async () => {
    const run = chromium();
    run.open(request(), fromTab(42));
    await settleAll();
    expect(run.calls.panels).toEqual([42]);
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
  });

  test("opens nothing for a request the wallet refused or that needs no approval", async () => {
    const run = chromium({ noApproval: true });
    run.open(request(), fromTab(42));
    await settleAll();
    expect(run.calls.panels).toEqual([42]);
    expect(run.calls.popups).toEqual([]);
    // It waited the whole accept window, then gave up. An approval that was
    // already pending before the request never counts as its own.
    expect(run.calls.waits).toBe(SURFACE_RESCUE_ACCEPT_MS / 250);
    // Dropped there: it never looked for a panel or tried the popup.
    expect(run.calls.lookups).toBe(0);
  });

  test("opens nothing when the approval is decided while the rescue waits", async () => {
    const run = chromium();
    const release = run.holdLookup();
    run.open(request(), fromTab(42));
    await settleAll();
    // Approved or denied in another surface meanwhile.
    run.approvals.splice(1);
    release();
    await settleAll();
    expect(run.calls.popups).toEqual([]);
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
      approvals: () => [],
      browser: { sidePanel: {} },
      now: () => 0,
      showPopup: async () => {
        throw new Error("refused");
      },
      wait: async () => undefined,
    });
    const attempt = rescue({ origin: ORIGIN, windowId: 7 });
    await expect(attempt()).resolves.toBeUndefined();
  });

  test("never runs for an open that succeeded, a gated or silent request, or a cooling tab", async () => {
    const opened = chromium({ openRejects: false });
    opened.open(request(), fromTab(42));
    await settleAll();
    expect(opened.calls.popups).toEqual([]);
    const blocked = chromium({ blocked: true });
    blocked.open(request(), fromTab(42));
    await settleAll();
    expect(blocked.calls).toEqual({ lookups: 0, panels: [], popups: [], sidebars: 0, waits: 0 });
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

  test("one at a time, throttled when it would open, not when it was asked", async () => {
    const run = chromium();
    // The first rescue is held in its context lookup while time passes.
    const release = run.holdLookup();
    run.open(request(), fromTab(1));
    await settleAll();
    run.tick(SURFACE_RESCUE_THROTTLE_MS + 1_000);
    // A second, while the first is outstanding, is dropped.
    run.open(request(), fromTab(2));
    await settleAll();
    release();
    await settleAll();
    expect(run.calls.panels).toEqual([1, 2]);
    // The second never even looked.
    expect(run.calls.lookups).toBe(1);
    expect(run.calls.popups).toHaveLength(1);
    // The interval runs from when the first opened, not from when it was asked.
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
    // The background wires the control's rescue, built from the pending
    // approvals, the browser, the clock and the control's popup opener only.
    const entry = await readFile("apps/extension/src/background/index.ts", "utf8");
    expect(entry).toContain("rescue: approvalSurface.rescue,");
    expect(entry).toContain("approvals: () => approvals.list(),");
    const control = await readFile(
      "apps/extension/src/background/approvals/approval-surface-control.ts",
      "utf8",
    );
    expect(control).toContain(
      "rescue: createSurfaceRescue({ approvals, browser, now, showPopup, wait }),",
    );
  });
});
