/**
 * A browser and preferences store for driving the side-panel learner (#690):
 * a panel that renders after some queries or never, saves that can be held or
 * refused, storage writes that can be refused, and every call recorded.
 */
import type { ApprovalSurfacePreference } from "@bramble/settings/preferences";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import {
  createSidePanelLearner,
  SIDE_PANEL_LEARNING_STORE_KEY,
  type SidePanelLearnerDeps,
} from "../../apps/extension/src/background/approvals/side-panel-learning";

export const PANEL_URL = "chrome-extension://bramble/sidepanel.html";

type Click = (tab?: { readonly windowId?: number }) => void;

export type LearningHarnessOptions = {
  readonly applyFails?: () => boolean;
  readonly contexts?: "fail" | "never" | number;
  readonly openRejects?: boolean;
  readonly preference?: ApprovalSurfacePreference;
  readonly saveFails?: (preference: ApprovalSurfacePreference) => boolean;
  readonly store?: KeyValueStore | null | "throws";
  /** Refuses a learning-record write when this returns true. */
  readonly writeFails?: (value: unknown) => boolean;
  readonly withSidePanel?: boolean;
};

/** Lets every queued promise in a learning chain settle. */
export const settleAll = async (): Promise<void> => {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
};

/** Builds a learner over a fake Chromium and preferences store. */
export const learningHarness = (options: LearningHarnessOptions = {}) => {
  const calls = {
    applied: [] as ApprovalSurfacePreference[],
    opens: [] as number[],
    popups: [] as unknown[],
    queries: 0,
    reconfigures: 0,
    saves: [] as ApprovalSurfacePreference[],
  };
  const listeners: Click[] = [];
  // What is in effect, and what the preferences store holds.
  let preference: ApprovalSurfacePreference = options.preference ?? "side-panel";
  let saved: ApprovalSurfacePreference = preference;
  let renders = false;
  let held: (() => void)[] | null = null;
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
  const deps: SidePanelLearnerDeps = {
    applySurface: async (next) => {
      preference = next;
      if (options.applyFails?.()) throw new Error("setPopup refused");
      calls.applied.push(next);
    },
    browser: {
      action: {
        onClicked: { addListener: (listener) => listeners.push(listener) },
        openPopup: async (popup) => {
          calls.popups.push(popup);
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
      },
      ...(options.withSidePanel === false
        ? {}
        : {
            sidePanel: {
              open: ({ windowId }: { readonly windowId: number }) => {
                calls.opens.push(windowId);
                return options.openRejects
                  ? Promise.reject(new Error("refused"))
                  : Promise.resolve();
              },
            },
          }),
    },
    extensionId: "bramble",
    preference: () => preference,
    reconfigure: () => {
      calls.reconfigures += 1;
    },
    saveSurface: async (next) => {
      calls.saves.push(next);
      if (options.saveFails?.(next)) throw new Error("preferences unavailable");
      if (held) await new Promise<void>((resolve) => held?.push(resolve));
      saved = next;
    },
    sidePanelUrl: PANEL_URL,
    store: () => {
      if (store === "throws") throw new Error("no storage.local");
      return store as KeyValueStore | null;
    },
    wait: async () => undefined,
  };
  const learner = createSidePanelLearner(deps);
  learner.bind();
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
    /** Holds every later preference save until `release`. */
    hold: () => {
      held = [];
    },
    learner,
    listeners,
    preference: () => preference,
    release: async () => {
      const waiting = held ?? [];
      held = null;
      for (const resolve of waiting) resolve();
      await settleAll();
    },
    render: () => {
      renders = true;
    },
    saved: () => saved,
    /** A message from the real side panel page. */
    sidePanelTalks: async () => {
      learner.observeSender({ id: "bramble", url: PANEL_URL });
      await settleAll();
    },
    stored: async () =>
      base && base !== "throws" ? base.get(SIDE_PANEL_LEARNING_STORE_KEY) : undefined,
    /** The user saves a surface in Settings: the store, then the callback. */
    userChooses: (next: ApprovalSurfacePreference) => {
      saved = next;
      preference = next;
      learner.userChose(next);
    },
  };
};
