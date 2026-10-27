/**
 * Learns once whether this browser actually draws Chromium's side panel (#690).
 *
 * Arc exposes `chrome.sidePanel` and `sidePanel.open()` resolves, but no panel
 * ever appears, so the API's own answer can't be trusted. Until a real side
 * panel has been seen, the toolbar click is routed here instead of Chromium's
 * built-in panel behavior. The panel is always asked to open first, exactly as
 * before, then the worker looks for a side-panel context. Seen, and the browser
 * goes back to the built-in behavior for good, which is what Chrome users get
 * on their first click. Never seen after the open resolved, and the request
 * surface switches to the compact popup, which Arc does draw.
 *
 * That switch heals itself. If a real side panel renders later (a slow Chrome
 * machine whose panel loaded after the wait), an automatic switch is undone. A
 * choice the user made in Settings is never undone, and any newer user choice
 * or panel render outranks an automatic change still being written.
 *
 * Automatic changes are journaled: the intent is stored before the preference
 * changes, so a worker that dies between the two writes is reconciled at the
 * next start instead of leaving a popup nobody can explain or undo.
 *
 * Only a click on Bramble's own toolbar action teaches this. Dapp requests
 * never do, and nothing here opens a window or moves focus. Every unknown
 * answer (a storage read or write that fails, a context query that fails, an
 * open that rejects) leaves today's behavior in place rather than switching.
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
 * before the self-healing switch above is ever needed.
 */
export const SIDE_PANEL_LEARN_TIMEOUT_MS = 5_000;
const POLL_MS = 250;

/**
 * `unknown`: no side panel seen yet, so toolbar clicks are learned from.
 * `verified`: a real side panel was seen; the built-in behavior applies.
 * `unsupported`: a click opened no panel, so the surface switched to the popup.
 *   The switch is `automatic` until the user makes their own choice in Settings.
 */
type SidePanelState = "unknown" | "unsupported" | "verified";

/**
 * What is stored. `pending` journals an automatic preference write in flight:
 * it is written first, and reconciled at start against the saved preference.
 */
type Learned = {
  readonly automatic: boolean;
  readonly notice: boolean;
  readonly pending?: ApprovalSurfacePreference;
  readonly state: SidePanelState;
};

const UNKNOWN: Learned = { automatic: false, notice: false, state: "unknown" };
const VERIFIED: Learned = { automatic: false, notice: false, state: "verified" };

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
  /** Applies a request surface to the toolbar; rejects when the browser refuses. */
  readonly applySurface: (preference: ApprovalSurfacePreference) => Promise<void>;
  readonly browser: SidePanelLearningBrowser | undefined;
  readonly extensionId: string;
  /** The request surface currently in effect. */
  readonly preference: () => ApprovalSurfacePreference;
  /** Re-applies the toolbar behavior after the learned state changes. */
  readonly reconfigure: () => void;
  /**
   * Writes a request surface to the preferences store without reporting it as
   * the user's choice. Used only for automatic changes and their corrections.
   */
  readonly saveSurface: (preference: ApprovalSurfacePreference) => Promise<void>;
  /** The side panel page's URL, e.g. `chrome-extension://<id>/sidepanel.html`. */
  readonly sidePanelUrl: string;
  /**
   * The `storage.local` adapter, resolved in `load` once trusted storage is
   * ready. Null (or a throw) means nothing is learned.
   */
  readonly store: () => KeyValueStore | null;
  readonly wait: (ms: number) => Promise<void>;
};

/** The learner, bound once at worker start. */
export type SidePanelLearner = {
  /** Registers the toolbar listener. Call once, at the top level. */
  readonly bind: () => void;
  /** Dismisses the one-time "opens as a popup" notice, once loaded. */
  readonly dismissNotice: () => Promise<void>;
  /** Loads and reconciles what was learned before. Resolves even when storage fails. */
  readonly load: () => Promise<void>;
  /** Whether Chromium should open the panel on toolbar click by itself. */
  readonly nativeClick: () => boolean;
  /** Whether the popup should show the one-time switch notice, once loaded. */
  readonly notice: () => Promise<boolean>;
  /** Marks the side panel seen when its page talks to the worker. */
  readonly observeSender: (sender: RuntimeSender | undefined) => void;
  readonly state: () => SidePanelState;
  /**
   * Records a request surface the user saved in Settings. After that, an
   * automatic switch is the user's choice too, and is never undone.
   */
  readonly userChose: (preference: ApprovalSurfacePreference) => void;
};

const readLearned = (value: unknown): Learned | null => {
  if (!isRecord(value)) return null;
  const state = value["state"];
  if (state !== "unknown" && state !== "unsupported" && state !== "verified") return null;
  const pending = value["pending"];
  const unsupported = state === "unsupported";
  return {
    automatic: unsupported && value["automatic"] === true,
    notice: unsupported && value["notice"] === true,
    ...(pending === "popup" || pending === "side-panel" ? { pending } : {}),
    state,
  };
};

const loadLearned = async (store: KeyValueStore): Promise<Learned | "unreadable" | null> => {
  try {
    return readLearned(await store.get(SIDE_PANEL_LEARNING_STORE_KEY));
  } catch {
    return "unreadable";
  }
};

const settled = ({ automatic, notice, state }: Learned): Learned => ({ automatic, notice, state });

// A journaled automatic write whose worker stopped before it finished: the
// saved preference says how far it got.
const reconcile = (learned: Learned, preference: ApprovalSurfacePreference): Learned => {
  if (learned.pending === undefined) return learned;
  if (learned.pending === "popup") {
    return preference === "popup"
      ? { automatic: true, notice: true, state: "unsupported" }
      : settled(learned);
  }
  return preference === "side-panel" ? VERIFIED : settled(learned);
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
  let markLoaded: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markLoaded = resolve;
  });
  let learned: Learned = UNKNOWN;
  // Read through a call, so a check after an await sees the current value.
  const switchedAutomatically = (): boolean => learned.state === "unsupported" && learned.automatic;
  let learning = false;
  // Provenance: each user choice and each panel render bumps its counter, and
  // an automatic change in flight compares them to know it was overtaken.
  let userChoices = 0;
  let lastUserChoice: ApprovalSurfacePreference | null = null;
  let renders = 0;
  // Automatic changes run one at a time, in the order they were decided.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    queue = queue.then(work, work);
    return queue;
  };

  // A strict write: false when storage refused, so a journal that can't be
  // kept stops the change it would have described.
  const write = (next: Learned): Promise<boolean> =>
    store ? succeeds(store.set(SIDE_PANEL_LEARNING_STORE_KEY, next)) : Promise.resolve(false);

  const record = (next: Learned): void => {
    learned = next;
    void write(next);
    deps.reconfigure();
  };

  // The toolbar must end up matching the saved surface. A refusal is retried
  // once; after that the next worker start applies the saved choice again.
  const applyOrRetry = async (surface: ApprovalSurfacePreference): Promise<void> => {
    if (!(await succeeds(deps.applySurface(surface)))) await succeeds(deps.applySurface(surface));
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

  // What an automatic change to `target` resolves to once its write lands: a
  // newer user choice wins the surface, and a newer panel render proves the
  // panel works.
  const outcomeOf = (
    target: ApprovalSurfacePreference,
    userSince: boolean,
    renderedSince: boolean,
  ): { readonly learned: Learned; readonly surface: ApprovalSurfacePreference } => {
    const surface =
      userSince && lastUserChoice ? lastUserChoice : renderedSince ? "side-panel" : target;
    if (renderedSince || target === "side-panel") return { learned: VERIFIED, surface };
    return {
      learned: { automatic: !userSince, notice: !userSince, state: "unsupported" },
      surface,
    };
  };

  // Journal, then preference, then outcome, then toolbar. Returns the surface
  // now in effect, or null when nothing changed.
  const automaticChange = async (
    target: ApprovalSurfacePreference,
  ): Promise<ApprovalSurfacePreference | null> => {
    const users = userChoices;
    const seen = renders;
    if (!(await write({ ...learned, pending: target }))) return null;
    if (!(await succeeds(deps.saveSurface(target)))) {
      void write(learned);
      return null;
    }
    const outcome = outcomeOf(target, userChoices !== users, renders !== seen);
    // A newer intent overtook this write: put its surface back on top. If that
    // save fails, the journal stays and the next start reconciles it.
    if (outcome.surface !== target && !(await succeeds(deps.saveSurface(outcome.surface)))) {
      return null;
    }
    learned = outcome.learned;
    void write(learned);
    await applyOrRetry(outcome.surface);
    return outcome.surface;
  };

  const switchToPopup = async (windowId: number, users: number, seen: number): Promise<void> => {
    const overtaken = userChoices !== users || renders !== seen;
    if (overtaken || learned.state !== "unknown" || deps.preference() !== "side-panel") return;
    // Only a switch that is still this learner's own opens the popup: a user
    // choice that overtook it is the user's to act on.
    if ((await automaticChange("popup")) !== "popup" || !switchedAutomatically()) return;
    // The popup is now the toolbar's own surface, so the next click opens it
    // natively. Opening it here as well is best effort: browsers that still
    // tie `openPopup` to the click's gesture refuse it this long after.
    void browser?.action?.openPopup?.({ windowId }).catch(() => undefined);
  };

  const learnFromClick = async (opening: Promise<void>, windowId: number): Promise<void> => {
    const users = userChoices;
    const seen = renders;
    // A refused open says nothing about whether panels render: learn nothing.
    if (!(await succeeds(opening))) return;
    const outcome = await watchForSidePanel(
      sidePanelSeen,
      deps.wait,
      () => learned.state !== "unknown" || userChoices !== users || renders !== seen,
    );
    if (outcome === "seen") {
      sawSidePanel();
      return;
    }
    if (outcome === "absent") await enqueue(() => switchToPopup(windowId, users, seen));
  };

  // A real side panel rendered. Before any decision that is the answer; after
  // an automatic switch it proves the switch wrong (a slow first load), so the
  // side panel is saved back. A switch the user kept in Settings stays.
  function sawSidePanel(): void {
    renders += 1;
    void enqueue(async () => {
      if (learned.state === "verified") return;
      if (learned.state === "unsupported" && learned.automatic) {
        // Not saved: the popup keeps working, and the next render tries again.
        await automaticChange("side-panel");
        return;
      }
      record(VERIFIED);
    });
  }

  // Reads what was learned, finishing any journaled change a stopped worker
  // left behind. Unreadable: behave as before this feature rather than learn
  // on top of state that may already say otherwise.
  const restore = async (from: KeyValueStore): Promise<void> => {
    const stored = await loadLearned(from);
    if (stored === "unreadable") {
      learned = VERIFIED;
    } else {
      learned = reconcile(stored ?? UNKNOWN, deps.preference());
      if (stored?.pending !== undefined) void write(learned);
    }
    canLearn = true;
  };

  const afterClick = async (opening: Promise<void>, windowId: number): Promise<void> => {
    await ready;
    if (!canLearn) return;
    // The toolbar only reaches this listener when no popup is set. With the
    // popup as the surface, that means applying it failed: apply it again.
    if (deps.preference() === "popup") {
      await applyOrRetry("popup");
      void browser?.action?.openPopup?.({ windowId }).catch(() => undefined);
      return;
    }
    if (learned.state !== "unknown" || learning) return;
    learning = true;
    await learnFromClick(opening, windowId).finally(() => {
      learning = false;
    });
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
      learned = { ...learned, notice: false };
      void write(learned);
    },
    async load() {
      store = resolveStore(canBind, deps.store);
      if (store) await restore(store);
      loaded = true;
      markLoaded();
      if (canLearn && learned.state !== "verified" && (await sidePanelSeen())) {
        sawSidePanel();
        return;
      }
      deps.reconfigure();
    },
    nativeClick: () => !canLearn || !loaded || learned.state !== "unknown",
    async notice() {
      await ready;
      return learned.state === "unsupported" && learned.notice;
    },
    observeSender(sender) {
      if (!isSidePanelSender(sender, deps.extensionId, deps.sidePanelUrl)) return;
      void ready.then(() => {
        if (canLearn && learned.state !== "verified") sawSidePanel();
      });
    },
    state: () => learned.state,
    userChose(preference) {
      userChoices += 1;
      lastUserChoice = preference;
      if (learned.state !== "unsupported" || !learned.automatic) return;
      learned = { ...learned, automatic: false, notice: false };
      void write(learned);
    },
  };
};
