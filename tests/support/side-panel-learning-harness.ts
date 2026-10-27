/**
 * A fake Chromium for driving the request-surface control and its side-panel
 * learner (#690): a panel that shows after some waits or never, a panel
 * document that may be alive without being shown (Arc), a toolbar
 * that keeps what it was configured to do and delivers clicks the way
 * Chromium does, storage writes that can be refused, and every call recorded.
 */
import type { ApprovalSurfacePreference } from "@bramble/settings/preferences";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import {
  type ApprovalSurfaceControlBrowser,
  createApprovalSurfaceControl,
} from "../../apps/extension/src/background/approvals/approval-surface-control";
import { SIDE_PANEL_LEARNING_STORE_KEY } from "../../apps/extension/src/background/approvals/side-panel-learning";

export const PANEL_URL = "chrome-extension://bramble/sidepanel.html";

type Click = (tab?: { readonly windowId?: number }) => void;

/** What the toolbar does on click: Chromium keeps this across worker restarts. */
export type ToolbarConfig = { readonly native: boolean; readonly popup: string };

export type SurfaceHarnessOptions = {
  readonly configureFails?: () => boolean;
  /** Holds a `setPopup` call until the returned promise settles. */
  readonly configureDelay?: (popup: string) => Promise<void> | undefined;
  /** A side panel document is alive (a SIDE_PANEL context), shown or not. */
  readonly panelDocument?: boolean;
  /** The side panel page reports itself visible on this wait of a learning window. */
  readonly showsAfter?: number;
  readonly openRejects?: boolean;
  /** The toolbar as the browser kept it before this worker started. */
  readonly persisted?: ToolbarConfig;
  /** `action.openPopup` refuses. */
  readonly popupRejects?: boolean;
  readonly preference?: ApprovalSurfacePreference;
  /** The stored choice read at start; rejects to model a failed read. */
  readonly read?: () => Promise<ApprovalSurfacePreference | undefined>;
  readonly store?: KeyValueStore | null | "throws";
  readonly withSidePanel?: boolean;
  /** Refuses a learning-record write when this returns true. */
  readonly writeFails?: (value: unknown) => boolean;
};

// The control's browser, plus the context query a real Chromium also has.
type HarnessBrowser = ApprovalSurfaceControlBrowser & {
  readonly runtime: {
    readonly getContexts: (filter: unknown) => Promise<readonly unknown[]>;
  };
};

/** Lets every queued promise in a learning chain settle. */
export const settleAll = async (): Promise<void> => {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
};

/** Builds the control over a fake Chromium, with the user's choice applied. */
export const surfaceHarness = (options: SurfaceHarnessOptions = {}) => {
  const calls = {
    native: [] as boolean[],
    /** Panels Chromium opened by itself, without the worker. */
    nativeOpens: [] as number[],
    opens: [] as number[],
    /** Popups Chromium showed because one was set. */
    popupClicks: [] as number[],
    popupSet: [] as string[],
    popups: [] as unknown[],
    /** Popups that actually opened. */
    shown: [] as unknown[],
    /** Side panel context queries, which the learner must never need. */
    queries: 0,
    /** Waits inside learning windows. */
    waits: 0,
  };
  const listeners: Click[] = [];
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
  const browser: HarnessBrowser = {
    action: {
      onClicked: { addListener: (listener) => listeners.push(listener) },
      openPopup: async (popup) => {
        calls.popups.push(popup);
        if (options.popupRejects) throw new Error("no popup");
        // As Chrome: only a popup that is set can open.
        if (toolbar().popup === "") throw new Error("Extension does not have a popup");
        calls.shown.push(popup?.windowId);
      },
      setPopup: async ({ popup }) => {
        await options.configureDelay?.(popup);
        if (options.configureFails?.()) throw new Error("setPopup refused");
        calls.popupSet.push(popup);
      },
    },
    runtime: {
      getContexts: async () => {
        calls.queries += 1;
        return options.panelDocument ? [{ contextType: "SIDE_PANEL", windowId: 7 }] : [];
      },
      getURL: (path: string) => `chrome-extension://bramble/${path}`,
    },
    ...(options.withSidePanel === false
      ? {}
      : {
          sidePanel: {
            open: (target: { readonly tabId: number } | { readonly windowId: number }) => {
              calls.opens.push("windowId" in target ? target.windowId : target.tabId);
              return options.openRejects ? Promise.reject(new Error("refused")) : Promise.resolve();
            },
            setPanelBehavior: async ({ openPanelOnActionClick }) => {
              calls.native.push(openPanelOnActionClick);
            },
          },
        }),
  };
  // The side panel page reports itself visible, as it does once Chromium draws it.
  const panelShows = (): void => control.learner.observeVisible({ id: "bramble", url: PANEL_URL });
  let windowWaits = 0;
  const control = createApprovalSurfaceControl({
    browser,
    extensionId: "bramble",
    now: () => 0,
    store: () => {
      if (store === "throws") throw new Error("no storage.local");
      return store as KeyValueStore | null;
    },
    wait: async () => {
      calls.waits += 1;
      windowWaits += 1;
      if (windowWaits === options.showsAfter) panelShows();
      const hook = duringWatch;
      duringWatch = null;
      hook?.();
    },
  });
  control.bind();
  const persisted = options.persisted ?? { native: false, popup: "" };
  /** What the toolbar is configured to do now. */
  const toolbar = (): ToolbarConfig => ({
    native: calls.native.at(-1) ?? persisted.native,
    popup: calls.popupSet.at(-1) ?? persisted.popup,
  });
  // Chromium: a set popup wins, then the built-in panel, then the listener.
  const deliver = (windowId: number): void => {
    const now = toolbar();
    if (now.popup !== "") {
      calls.popupClicks.push(windowId);
    } else if (now.native && options.withSidePanel !== false) {
      calls.nativeOpens.push(windowId);
    } else {
      windowWaits = 0;
      for (const listener of listeners) listener({ windowId });
    }
  };
  const sidePanelShows = async () => {
    panelShows();
    await settleAll();
  };
  return {
    calls,
    /** Clicks the toolbar action without waiting for anything. */
    clickNow: (windowId = 7) => deliver(windowId),
    click: async (windowId = 7) => {
      deliver(windowId);
      await settleAll();
    },
    control,
    learner: control.learner,
    listeners,
    /** Starts the worker's surface with the stored choice, and settles. */
    load: async () => {
      await control.start(
        options.read ? options.read() : Promise.resolve(options.preference ?? "side-panel"),
      );
      await settleAll();
    },
    /** Runs `hook` once, inside the next learning window. */
    onWatch: (hook: () => void) => {
      duringWatch = hook;
    },
    /** The side panel page reports itself visible, and everything settles. */
    sidePanelShows,
    stored: async () =>
      base && base !== "throws" ? base.get(SIDE_PANEL_LEARNING_STORE_KEY) : undefined,
    toolbar,
    /** The user saves a surface in Settings. */
    userChooses: (next: ApprovalSurfacePreference) => control.update(next),
  };
};
