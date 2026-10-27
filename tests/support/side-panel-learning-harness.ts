/**
 * A fake Chromium for driving the request-surface control and its side-panel
 * learner (#690): a panel that renders after some queries or never, a toolbar
 * that records what it was configured to do, storage writes that can be
 * refused, and every call recorded.
 */
import type { ApprovalSurfacePreference } from "@bramble/settings/preferences";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { createApprovalSurfaceControl } from "../../apps/extension/src/background/approvals/approval-surface-control";
import { SIDE_PANEL_LEARNING_STORE_KEY } from "../../apps/extension/src/background/approvals/side-panel-learning";

export const PANEL_URL = "chrome-extension://bramble/sidepanel.html";

type Click = (tab?: { readonly windowId?: number }) => void;

export type SurfaceHarnessOptions = {
  readonly configureFails?: () => boolean;
  readonly contexts?: "fail" | "never" | number;
  readonly openRejects?: boolean;
  readonly preference?: ApprovalSurfacePreference;
  readonly store?: KeyValueStore | null | "throws";
  readonly withSidePanel?: boolean;
  /** Refuses a learning-record write when this returns true. */
  readonly writeFails?: (value: unknown) => boolean;
};

/** Lets every queued promise in a learning chain settle. */
export const settleAll = async (): Promise<void> => {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
};

/** Builds the control over a fake Chromium, with the user's choice applied. */
export const surfaceHarness = (options: SurfaceHarnessOptions = {}) => {
  const calls = {
    native: [] as boolean[],
    opens: [] as number[],
    popupSet: [] as string[],
    popups: [] as unknown[],
    queries: 0,
  };
  const listeners: Click[] = [];
  let renders = false;
  // Runs once on the next wait inside a learning window, then clears.
  let duringWatch: (() => void) | null = null;
  const base = options.store === undefined ? createMemoryStore() : options.store;
  const store =
    base && base !== "throws" && options.writeFails
      ? {
          ...base,
          set: async (key: string, value: unknown) => {
            if (key === SIDE_PANEL_LEARNING_STORE_KEY && options.writeFails?.(value)) {
              throw new Error("quota");
            }
            return base.set(key, value as never);
          },
        }
      : base;
  const control = createApprovalSurfaceControl({
    browser: {
      action: {
        onClicked: { addListener: (listener) => listeners.push(listener) },
        openPopup: async (popup) => {
          calls.popups.push(popup);
        },
        setPopup: async ({ popup }) => {
          if (options.configureFails?.()) throw new Error("setPopup refused");
          calls.popupSet.push(popup);
        },
      },
      runtime: {
        getContexts: async () => {
          calls.queries += 1;
          if (options.contexts === "fail") throw new Error("unavailable");
          const after = options.contexts ?? "never";
          return renders || (after !== "never" && calls.queries > after)
            ? [{ contextType: "SIDE_PANEL" }]
            : [];
        },
        getURL: (path) => `chrome-extension://bramble/${path}`,
      },
      ...(options.withSidePanel === false
        ? {}
        : {
            sidePanel: {
              open: (target: { readonly tabId: number } | { readonly windowId: number }) => {
                calls.opens.push("windowId" in target ? target.windowId : target.tabId);
                return options.openRejects
                  ? Promise.reject(new Error("refused"))
                  : Promise.resolve();
              },
              setPanelBehavior: async ({ openPanelOnActionClick }) => {
                calls.native.push(openPanelOnActionClick);
              },
            },
          }),
    },
    extensionId: "bramble",
    store: () => {
      if (store === "throws") throw new Error("no storage.local");
      return store as KeyValueStore | null;
    },
    wait: async () => {
      const hook = duringWatch;
      duringWatch = null;
      hook?.();
    },
  });
  control.bind();
  control.apply(options.preference ?? "side-panel");
  const sidePanelTalks = async () => {
    control.learner.observeSender({ id: "bramble", url: PANEL_URL });
    await settleAll();
  };
  return {
    calls,
    /** Clicks the toolbar action without waiting for anything. */
    clickNow: (windowId = 7) => {
      for (const listener of listeners) listener({ windowId });
    },
    click: async (windowId = 7) => {
      for (const listener of listeners) listener({ windowId });
      await settleAll();
    },
    control,
    learner: control.learner,
    listeners,
    load: async () => {
      await control.load();
      await settleAll();
    },
    /** Runs `hook` once, inside the next learning window. */
    onWatch: (hook: () => void) => {
      duringWatch = hook;
    },
    render: () => {
      renders = true;
    },
    sidePanelTalks,
    stored: async () =>
      base && base !== "throws" ? base.get(SIDE_PANEL_LEARNING_STORE_KEY) : undefined,
    /** What the toolbar was last configured to do. */
    toolbar: () => ({ native: calls.native.at(-1), popup: calls.popupSet.at(-1) }),
    /** The user saves a surface in Settings. */
    userChooses: (next: ApprovalSurfacePreference) => control.update(next),
  };
};
