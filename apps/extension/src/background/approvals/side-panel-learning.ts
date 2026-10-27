/**
 * Learns once whether this browser actually draws Chromium's side panel (#690).
 *
 * Arc exposes `chrome.sidePanel` and `sidePanel.open()` resolves, but no panel
 * ever appears, so the API's own answer can't be trusted. Until a real side
 * panel has been seen, the toolbar click is routed here instead of Chromium's
 * built-in panel behavior. The panel is always asked to open first, exactly as
 * before, then the worker looks for a side-panel context. Seen, and the browser
 * is `verified`: the built-in behavior applies for good, which is what Chrome
 * users get on their first click. Never seen after the open resolved, and the
 * browser is `unsupported`: the side-panel choice is served as the compact
 * popup instead, which Arc does draw.
 *
 * The learner writes only its own record. The user's request-surface choice
 * is never written here; the surface in effect is derived from both where the
 * toolbar is configured (./approval-surface-control). So nothing the learner
 * does can overwrite a choice, and a restart at any point finds one coherent
 * record. A real side panel seen at any time marks the browser `verified`,
 * which undoes a wrong `unsupported` (a slow Chrome machine whose panel loaded
 * after the wait).
 *
 * Only a click on Bramble's own toolbar action teaches this. Dapp requests
 * never do, and nothing here opens a window or moves focus. An unreadable or
 * unwritable record stops learning and keeps today's behavior.
 */

import { isRecord } from "@bramble/core/json";
import type { ApprovalSurfacePreference } from "@bramble/settings/preferences";
import type { KeyValueStore } from "@bramble/store/kv";
import type { RuntimeSender } from "../routing/senders";

/** Plain `storage.local` key holding what this browser was learned to do. */
export const SIDE_PANEL_LEARNING_STORE_KEY = "bramble:side-panel-learning";

/**
 * How long a toolbar click waits for the side panel to load before deciding.
 * Chrome draws it well inside a second, and Arc never does, so a longer wait
 * costs only Arc's first click; it also leaves a slow Chrome machine room
 * before a later render has to correct the answer.
 */
export const SIDE_PANEL_LEARN_TIMEOUT_MS = 5_000;
const POLL_MS = 250;

/**
 * `unknown`: no side panel seen yet, so toolbar clicks are learned from.
 * `verified`: a real side panel was seen; the built-in behavior applies.
 * `unsupported`: a click opened no panel; the side panel is served as the popup.
 */
type SidePanelState = "unknown" | "unsupported" | "verified";

/** The learner's one record: its state, and whether the popup notice is due. */
type Learned = { readonly notice: boolean; readonly state: SidePanelState };

const UNKNOWN: Learned = { notice: false, state: "unknown" };
const VERIFIED: Learned = { notice: false, state: "verified" };
const UNSUPPORTED: Learned = { notice: true, state: "unsupported" };

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
  /** Applies the surface in effect to the toolbar; rejects when the browser refuses. */
  readonly configure: () => Promise<void>;
  readonly extensionId: string;
  /** The side panel page's URL, e.g. `chrome-extension://<id>/sidepanel.html`. */
  readonly sidePanelUrl: string;
  /**
   * The `storage.local` adapter, resolved in `load` once trusted storage is
   * ready. Null (or a throw) means nothing is learned.
   */
  readonly store: () => KeyValueStore | null;
  /** The surface in effect: the user's choice, after what was learned. */
  readonly surface: () => ApprovalSurfacePreference;
  readonly wait: (ms: number) => Promise<void>;
};

/** The learner, bound once at worker start. */
export type SidePanelLearner = {
  /** Registers the toolbar listener. Call once, at the top level. */
  readonly bind: () => void;
  /** Dismisses the one-time "opens as a popup" notice, once loaded. */
  readonly dismissNotice: () => Promise<void>;
  /** Loads what was learned before. Resolves even when storage fails. */
  readonly load: () => Promise<void>;
  /** Whether Chromium should open the panel on toolbar click by itself. */
  readonly nativeClick: () => boolean;
  /** Whether the popup should show the one-time notice, once loaded. */
  readonly notice: () => Promise<boolean>;
  /** Marks the side panel seen when its page talks to the worker. */
  readonly observeSender: (sender: RuntimeSender | undefined) => void;
  /**
   * The user chose the side panel in Settings. On a browser learned to be
   * `unsupported` that reads as "try again": the next click learns afresh.
   */
  readonly retrySidePanel: () => void;
  readonly state: () => SidePanelState;
};

const readLearned = (value: unknown): Learned | null => {
  if (!isRecord(value)) return null;
  const state = value["state"];
  if (state !== "unknown" && state !== "unsupported" && state !== "verified") return null;
  return { notice: state === "unsupported" && value["notice"] === true, state };
};

const loadLearned = async (store: KeyValueStore): Promise<Learned | "unreadable" | null> => {
  try {
    return readLearned(await store.get(SIDE_PANEL_LEARNING_STORE_KEY));
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
 * Creates the learner. It learns nothing (and never serves the popup in place
 * of the side panel) where the browser lacks the side panel, the context query
 * or the toolbar event, or where storage is unavailable.
 */
export const createSidePanelLearner = (deps: SidePanelLearnerDeps): SidePanelLearner => {
  const { browser } = deps;
  const getContexts = browser?.runtime?.getContexts;
  const canBind = Boolean(browser?.sidePanel?.open && getContexts && browser.action?.onClicked);
  let store: KeyValueStore | null = null;
  // Learning runs only where the browser can be taught and storage keeps the
  // answer; everywhere else the built-in behavior stays, as before.
  let canLearn = false;
  let loaded = false;
  let markLoaded: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markLoaded = resolve;
  });
  let learned: Learned = UNKNOWN;
  // Read through a call, so a check after an await sees the current value.
  const stateNow = (): SidePanelState => learned.state;
  let learning = false;
  // Record changes run one at a time and check their condition when they run,
  // so a late learning result can't overwrite a newer observation.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    queue = queue.then(work, work);
    return queue;
  };

  const reconfigure = (): void => void deps.configure().catch(() => undefined);

  // Stores the record, then takes it. A write that fails stops learning: the
  // browser falls back to today's behavior rather than act on an answer that
  // a restart would lose.
  const commit = async (next: Learned): Promise<void> => {
    if (store && (await succeeds(store.set(SIDE_PANEL_LEARNING_STORE_KEY, next)))) {
      learned = next;
    } else {
      canLearn = false;
      learned = VERIFIED;
    }
    reconfigure();
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

  // A real side panel rendered: the browser draws it, whatever was learned.
  const sawSidePanel = (): Promise<void> =>
    enqueue(async () => {
      if (canLearn && learned.state !== "verified") await commit(VERIFIED);
    });

  const learnFromClick = async (opening: Promise<void>, windowId: number): Promise<void> => {
    // A refused open says nothing about whether panels render: learn nothing.
    if (!(await succeeds(opening))) return;
    const outcome = await watchForSidePanel(
      sidePanelSeen,
      deps.wait,
      () => stateNow() !== "unknown",
    );
    if (outcome === "seen") {
      await sawSidePanel();
      return;
    }
    if (outcome !== "absent") return;
    await enqueue(async () => {
      if (!canLearn || learned.state !== "unknown") return;
      await commit(UNSUPPORTED);
    });
    // The popup now serves the side-panel choice, so the next click opens it
    // natively. Opening it here as well is best effort: browsers that still
    // tie `openPopup` to the click's gesture refuse it this long after.
    if (stateNow() === "unsupported") {
      void browser?.action?.openPopup?.({ windowId }).catch(() => undefined);
    }
  };

  const afterClick = async (opening: Promise<void>, windowId: number): Promise<void> => {
    await ready;
    if (!canLearn) return;
    // The toolbar only reaches this listener when no popup is set. With the
    // popup in effect, that means applying it failed: apply it again.
    if (deps.surface() === "popup") {
      if (!(await succeeds(deps.configure()))) await succeeds(deps.configure());
      void browser?.action?.openPopup?.({ windowId }).catch(() => undefined);
      return;
    }
    if (learned.state !== "unknown" || learning) return;
    learning = true;
    await learnFromClick(opening, windowId).finally(() => {
      learning = false;
    });
  };

  // Reads what was learned. Unreadable: keep today's behavior rather than
  // learn on top of state that may already say otherwise.
  const restore = async (from: KeyValueStore): Promise<void> => {
    const stored = await loadLearned(from);
    if (stored === "unreadable") return;
    learned = stored ?? UNKNOWN;
    canLearn = true;
  };

  return {
    bind() {
      if (!canBind) return;
      browser?.action?.onClicked?.addListener((tab) => {
        const windowId = tab?.windowId;
        const open = browser.sidePanel?.open;
        if (typeof windowId !== "number" || !open) return;
        // Always first, and synchronously: this listener only fires when no
        // popup is set, the click's gesture is what lets the panel open at all,
        // and a worker the click just woke hasn't loaded anything yet.
        const opening = open({ windowId });
        void opening.catch(() => undefined);
        void afterClick(opening, windowId);
      });
    },
    async dismissNotice() {
      await ready;
      if (!learned.notice) return;
      await enqueue(async () => {
        if (!learned.notice) return;
        const next = { ...learned, notice: false };
        // A dismissal that can't be stored still hides it for this session.
        if (store) await succeeds(store.set(SIDE_PANEL_LEARNING_STORE_KEY, next));
        learned = next;
      });
    },
    async load() {
      store = resolveStore(canBind, deps.store);
      if (store) await restore(store);
      loaded = true;
      markLoaded();
      if (canLearn && learned.state !== "verified" && (await sidePanelSeen())) {
        await sawSidePanel();
        return;
      }
      reconfigure();
    },
    nativeClick: () => !canLearn || !loaded || learned.state !== "unknown",
    async notice() {
      await ready;
      return learned.state === "unsupported" && learned.notice;
    },
    observeSender(sender) {
      if (!isSidePanelSender(sender, deps.extensionId, deps.sidePanelUrl)) return;
      void ready.then(sawSidePanel);
    },
    retrySidePanel() {
      void ready.then(() =>
        enqueue(async () => {
          if (canLearn && learned.state === "unsupported") await commit(UNKNOWN);
        }),
      );
    },
    state: () => learned.state,
  };
};
