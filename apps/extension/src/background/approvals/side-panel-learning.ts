/**
 * Learns once whether this browser actually draws Chromium's side panel (#690).
 *
 * Arc exposes `chrome.sidePanel` and `sidePanel.open()` resolves, but no panel
 * ever appears, so the API's own answer can't be trusted. Until a real side
 * panel has been seen, the toolbar click is routed here instead of Chromium's
 * built-in panel behavior: the panel is asked to open exactly as before, and
 * the worker then looks for a side-panel context. Seen, and the browser goes
 * back to the built-in behavior for good, which is what Chrome users get on
 * their first click. Never seen after the open resolved, and the request
 * surface switches once to the compact popup, which Arc does draw.
 *
 * Only a click on Bramble's own toolbar action teaches this. Dapp requests
 * never do, and nothing here opens a window or moves focus. Every unknown
 * answer (a storage read that fails, a context query that fails, an open that
 * rejects) leaves today's behavior in place rather than switching.
 */

import { isRecord } from "@bramble/core/json";
import type { ApprovalSurfacePreference } from "@bramble/settings/preferences";
import type { KeyValueStore } from "@bramble/store/kv";
import type { RuntimeSender } from "../routing/senders";

/** Plain `storage.local` key holding what this browser was learned to do. */
export const SIDE_PANEL_LEARNING_STORE_KEY = "bramble:side-panel-learning";

/** How long a toolbar click waits for the side panel to load before deciding. */
export const SIDE_PANEL_LEARN_TIMEOUT_MS = 3_000;
const POLL_MS = 250;

/**
 * `unknown`: no side panel seen yet, so toolbar clicks are learned from.
 * `verified`: a real side panel was seen; the built-in behavior applies.
 * `unsupported`: a click opened no panel, so the surface switched to the popup.
 */
type SidePanelState = "unknown" | "unsupported" | "verified";

/** The browser slices the learner reads. Every member is optional. */
export type SidePanelLearningBrowser = {
  readonly action?: {
    readonly onClicked?: {
      readonly addListener: (listener: (tab?: { readonly windowId?: number }) => void) => void;
    };
    readonly openPopup?: (options?: { readonly windowId?: number }) => Promise<void>;
  };
  readonly runtime?: {
    readonly getContexts?: (filter: {
      readonly contextTypes: readonly string[];
    }) => Promise<readonly unknown[]>;
  };
  readonly sidePanel?: {
    readonly open: (options: { readonly windowId: number }) => Promise<void>;
  };
};

/** What the learner needs from the background. */
export type SidePanelLearnerDeps = {
  readonly browser: SidePanelLearningBrowser | undefined;
  readonly extensionId: string;
  /** The user's current request-surface choice. */
  readonly preference: () => ApprovalSurfacePreference;
  /** Re-applies the toolbar behavior after the learned state changes. */
  readonly reconfigure: () => void;
  /** The side panel page's URL, e.g. `chrome-extension://<id>/sidepanel.html`. */
  readonly sidePanelUrl: string;
  /**
   * The `storage.local` adapter, resolved in `load` once trusted storage is
   * ready. Null (or a throw) means nothing is learned.
   */
  readonly store: () => KeyValueStore | null;
  /** Saves "popup" as the user's request surface and applies it. */
  readonly switchToPopup: () => Promise<void>;
  readonly wait: (ms: number) => Promise<void>;
};

/** The learner, bound once at worker start. */
export type SidePanelLearner = {
  /** Registers the toolbar listener. Call once, at the top level. */
  readonly bind: () => void;
  /** Dismisses the one-time "opens as a popup" notice. */
  readonly dismissNotice: () => Promise<void>;
  /** Loads what was learned before. Resolves even when storage fails. */
  readonly load: () => Promise<void>;
  /** Whether Chromium should open the panel on toolbar click by itself. */
  readonly nativeClick: () => boolean;
  /** Whether the popup should show the one-time switch notice. */
  readonly notice: () => boolean;
  /** Marks the side panel seen when its page talks to the worker. */
  readonly observeSender: (sender: RuntimeSender | undefined) => void;
  readonly state: () => SidePanelState;
};

type Stored = { readonly notice: boolean; readonly state: SidePanelState };

const readStored = (value: unknown): Stored | null => {
  if (!isRecord(value)) return null;
  const state = value["state"];
  if (state !== "unsupported" && state !== "verified") return null;
  return { notice: state === "unsupported" && value["notice"] === true, state };
};

const readLearned = async (store: KeyValueStore): Promise<Stored | "unreadable" | null> => {
  try {
    return readStored(await store.get(SIDE_PANEL_LEARNING_STORE_KEY));
  } catch {
    return "unreadable";
  }
};

const resolveStore = (
  canBind: boolean,
  store: () => KeyValueStore | null,
): KeyValueStore | null => {
  if (!canBind) return null;
  try {
    return store();
  } catch {
    return null;
  }
};

// After the open resolved: "seen" once a side panel context exists, "absent"
// when none appeared in the whole window, and "unknown" when a query failed or
// `decided()` reports that something else settled the answer first.
const watchForSidePanel = async (
  seen: () => Promise<boolean | null>,
  wait: (ms: number) => Promise<void>,
  decided: () => boolean,
): Promise<"absent" | "seen" | "unknown"> => {
  for (let waited = 0; waited <= SIDE_PANEL_LEARN_TIMEOUT_MS; waited += POLL_MS) {
    if (decided()) return "unknown";
    const answer = await seen();
    if (answer !== false) return answer ? "seen" : "unknown";
    await wait(POLL_MS);
  }
  return "absent";
};

// Only the side panel page runs at this URL without a tab: the options page
// shows the same file in a tab, and the popup is another file.
const isSidePanelSender = (
  sender: RuntimeSender | undefined,
  extensionId: string,
  sidePanelUrl: string,
): boolean =>
  sidePanelUrl !== "" &&
  sender?.id === extensionId &&
  sender.tab === undefined &&
  typeof sender.url === "string" &&
  sender.url.startsWith(sidePanelUrl);

const succeeds = (work: Promise<unknown>): Promise<boolean> =>
  work.then(
    () => true,
    () => false,
  );

/**
 * Creates the learner. It learns nothing (and never switches) where the
 * browser lacks the side panel, the context query or the toolbar event, or
 * where storage is unavailable: those browsers keep today's behavior.
 */
export const createSidePanelLearner = (deps: SidePanelLearnerDeps): SidePanelLearner => {
  const { browser } = deps;
  const getContexts = browser?.runtime?.getContexts;
  const canBind = Boolean(browser?.sidePanel?.open && getContexts && browser.action?.onClicked);
  let store: KeyValueStore | null = null;
  // Learning runs only where the browser can be taught and storage can keep
  // the answer; everywhere else the built-in behavior stays, as before.
  let canLearn = false;
  let loaded = false;
  let state: SidePanelState = "unknown";
  let noticePending = false;
  let learning = false;

  const persist = (): void => {
    if (!store || state === "unknown") return;
    void store
      .set(SIDE_PANEL_LEARNING_STORE_KEY, { notice: noticePending, state })
      .catch(() => undefined);
  };

  const settle = (next: Exclude<SidePanelState, "unknown">, notice = false): void => {
    state = next;
    noticePending = notice;
    persist();
    deps.reconfigure();
  };

  // True when a side panel context exists now; null when the query failed,
  // which is never read as "no panel".
  const sidePanelSeen = async (): Promise<boolean | null> => {
    try {
      return ((await getContexts?.({ contextTypes: ["SIDE_PANEL"] })) ?? []).length > 0;
    } catch {
      return null;
    }
  };

  const learnFromClick = async (opening: Promise<void>, windowId: number): Promise<void> => {
    // A refused open says nothing about whether panels render: learn nothing.
    if (!(await succeeds(opening))) return;
    const outcome = await watchForSidePanel(sidePanelSeen, deps.wait, () => state !== "unknown");
    if (outcome === "seen") {
      settle("verified");
      return;
    }
    if (outcome === "unknown" || state !== "unknown" || deps.preference() !== "side-panel") return;
    // The choice couldn't be saved: keep learning, and switch nothing.
    if (!(await succeeds(deps.switchToPopup()))) return;
    settle("unsupported", true);
    // The popup is now the toolbar's own surface, so the next click opens it
    // natively. Opening it here as well is best effort: browsers that still
    // tie `openPopup` to the click's gesture refuse it this long after.
    void browser?.action?.openPopup?.({ windowId }).catch(() => undefined);
  };

  return {
    bind() {
      if (!canBind) return;
      browser?.action?.onClicked?.addListener((tab) => {
        if (!canLearn || state !== "unknown" || deps.preference() !== "side-panel") return;
        const windowId = tab?.windowId;
        const open = browser.sidePanel?.open;
        if (typeof windowId !== "number" || !open) return;
        // Called first and synchronously: the click's gesture is what lets the
        // panel open at all, and any await before it would spend it.
        const opening = open({ windowId });
        if (learning) {
          void opening.catch(() => undefined);
          return;
        }
        learning = true;
        void learnFromClick(opening, windowId).finally(() => {
          learning = false;
        });
      });
    },
    async dismissNotice() {
      if (!noticePending) return;
      noticePending = false;
      persist();
    },
    async load() {
      store = resolveStore(canBind, deps.store);
      loaded = true;
      if (!store) return;
      const stored = await readLearned(store);
      // Unreadable: behave as before this feature rather than learn on top of
      // state that may already say otherwise.
      if (stored === "unreadable") state = "verified";
      else if (stored) {
        state = stored.state;
        noticePending = stored.notice;
      }
      canLearn = true;
      if (state === "unknown" && (await sidePanelSeen())) {
        settle("verified");
        return;
      }
      deps.reconfigure();
    },
    nativeClick: () => !canLearn || !loaded || state !== "unknown",
    notice: () => state === "unsupported" && noticePending,
    observeSender(sender) {
      if (state === "verified" || !canLearn) return;
      if (isSidePanelSender(sender, deps.extensionId, deps.sidePanelUrl)) settle("verified");
    },
    state: () => state,
  };
};
