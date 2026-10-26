/**
 * Side-panel learning (#690). Arc exposes `chrome.sidePanel` and `open()`
 * resolves, but no panel is ever drawn. A toolbar click is the only teacher:
 * a side panel seen means the built-in behavior for good (Chrome), none seen
 * after a resolved open means one switch to the compact popup (Arc). No path
 * here opens a window, and every unknown answer keeps today's behavior.
 */
import { describe, expect, test } from "bun:test";
import type { ApprovalSurfacePreference } from "@bramble/settings/preferences";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import {
  createSidePanelLearner,
  SIDE_PANEL_LEARN_TIMEOUT_MS,
  SIDE_PANEL_LEARNING_STORE_KEY,
  type SidePanelLearnerDeps,
} from "../../../apps/extension/src/background/approvals/side-panel-learning";

const PANEL_URL = "chrome-extension://bramble/sidepanel.html";
type Click = (tab?: { readonly windowId?: number }) => void;

// A browser whose side panel either renders (a context appears after `delay`
// queries) or never does. Every call is recorded.
const harness = (
  options: {
    readonly contexts?: "fail" | "never" | number;
    readonly openRejects?: boolean;
    readonly preference?: ApprovalSurfacePreference;
    readonly restoreFails?: boolean;
    readonly store?: KeyValueStore | null | "throws";
    readonly switchFails?: boolean;
    readonly withSidePanel?: boolean;
  } = {},
) => {
  const calls = { opens: [] as number[], popups: [] as unknown[], queries: 0, reconfigures: 0 };
  const listeners: Click[] = [];
  let preference: ApprovalSurfacePreference = options.preference ?? "side-panel";
  let switches = 0;
  let restores = 0;
  // Flipped by a test to make a side panel render late (a slow first load).
  let renders = false;
  const store = options.store === undefined ? createMemoryStore() : options.store;
  const deps: SidePanelLearnerDeps = {
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
    restoreSidePanel: async () => {
      if (options.restoreFails) throw new Error("preferences unavailable");
      restores += 1;
      preference = "side-panel";
    },
    sidePanelUrl: PANEL_URL,
    store: () => {
      if (store === "throws") throw new Error("no storage.local");
      return store;
    },
    switchToPopup: async () => {
      if (options.switchFails) throw new Error("preferences unavailable");
      switches += 1;
      preference = "popup";
    },
    wait: async () => undefined,
  };
  const learner = createSidePanelLearner(deps);
  learner.bind();
  // Lets every queued promise in the learning chain settle.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 200; i += 1) await Promise.resolve();
  };
  const click = async (windowId = 7): Promise<void> => {
    for (const listener of listeners) listener({ windowId });
    await settle();
  };
  return {
    calls,
    click,
    learner,
    listeners,
    render: () => {
      renders = true;
    },
    restores: () => restores,
    setPreference: (next: ApprovalSurfacePreference) => {
      preference = next;
    },
    settle,
    stored: async () =>
      store && store !== "throws" ? store.get(SIDE_PANEL_LEARNING_STORE_KEY) : undefined,
    switches: () => switches,
  };
};

describe("side-panel learning", () => {
  test("keeps the built-in toolbar behavior until it has loaded", () => {
    const { learner } = harness();
    expect(learner.nativeClick()).toBe(true);
  });

  test("a side panel that loads verifies the browser and restores the built-in behavior", async () => {
    const run = harness({ contexts: 2 });
    await run.learner.load();
    expect(run.learner.nativeClick()).toBe(false);
    await run.click();
    expect(run.calls.opens).toEqual([7]);
    expect(run.learner.state()).toBe("verified");
    expect(run.learner.nativeClick()).toBe(true);
    expect(await run.stored()).toEqual({ automatic: false, notice: false, state: "verified" });
    expect(run.switches()).toBe(0);
    expect(run.calls.popups).toEqual([]);
  });

  test("a resolved open with no panel switches to the popup once and opens it", async () => {
    const run = harness();
    await run.learner.load();
    await run.click();
    expect(run.calls.opens).toEqual([7]);
    // The whole window was watched before deciding.
    expect(run.calls.queries).toBeGreaterThan(SIDE_PANEL_LEARN_TIMEOUT_MS / 250);
    expect(run.switches()).toBe(1);
    expect(run.learner.state()).toBe("unsupported");
    expect(run.learner.notice()).toBe(true);
    expect(await run.stored()).toEqual({ automatic: true, notice: true, state: "unsupported" });
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
    // The popup is the toolbar's own surface now: later clicks learn nothing.
    await run.click();
    expect(run.calls.opens).toEqual([7]);
    expect(run.switches()).toBe(1);
  });

  test("never overrides the user's later choice of the side panel", async () => {
    const run = harness();
    await run.learner.load();
    await run.click();
    run.setPreference("side-panel");
    run.learner.userChose();
    expect(run.learner.nativeClick()).toBe(true);
    await run.click();
    expect(run.switches()).toBe(1);
    expect(run.calls.opens).toEqual([7]);
  });

  test("a refused open, a failed context query or an unsaved choice switches nothing", async () => {
    for (const options of [
      { openRejects: true },
      { contexts: "fail" as const },
      { switchFails: true },
    ]) {
      const run = harness(options);
      await run.learner.load();
      await run.click();
      expect(run.switches()).toBe(0);
      expect(run.learner.state()).toBe("unknown");
      expect(run.learner.notice()).toBe(false);
      expect(run.calls.popups).toEqual([]);
    }
  });

  test("learns only in the side-panel preference and only from a window-bound click", async () => {
    const popupRun = harness({ preference: "popup" });
    await popupRun.learner.load();
    await popupRun.click();
    expect(popupRun.calls.opens).toEqual([]);
    const run = harness();
    await run.learner.load();
    for (const listener of run.listeners) listener({});
    for (const listener of run.listeners) listener(undefined);
    expect(run.calls.opens).toEqual([]);
  });

  test("a second click while one is being learned opens the panel but learns once", async () => {
    const run = harness();
    await run.learner.load();
    for (const listener of run.listeners) {
      listener({ windowId: 7 });
      listener({ windowId: 7 });
    }
    await run.click(8);
    expect(run.calls.opens.slice(0, 2)).toEqual([7, 7]);
    expect(run.switches()).toBe(1);
    // The second click asked for the panel but watched for it no more than once.
    const single = harness();
    await single.learner.load();
    await single.click();
    expect(run.calls.queries).toBe(single.calls.queries);
  });

  test("a panel already open when the worker starts verifies the browser", async () => {
    const run = harness({ contexts: 0 });
    await run.learner.load();
    expect(run.learner.state()).toBe("verified");
    expect(run.learner.nativeClick()).toBe(true);
  });

  test("what was learned before is kept across worker restarts", async () => {
    for (const [stored, native] of [
      [{ notice: false, state: "verified" }, true],
      [{ notice: true, state: "unsupported" }, true],
      [{ state: "bogus" }, false],
      [null, false],
    ] as const) {
      const store = createMemoryStore();
      if (stored) await store.set(SIDE_PANEL_LEARNING_STORE_KEY, stored);
      const run = harness({ store });
      await run.learner.load();
      expect(run.learner.nativeClick()).toBe(native);
    }
  });

  test("no storage, an unreadable store or a browser without side panels learns nothing", async () => {
    const unreadable = createMemoryStore();
    const failing: KeyValueStore = {
      ...unreadable,
      get: async () => {
        throw new Error("corrupt");
      },
    };
    for (const options of [
      { store: null },
      { store: "throws" as const },
      { store: failing },
      { withSidePanel: false },
    ]) {
      const run = harness(options);
      await run.learner.load();
      expect(run.learner.nativeClick()).toBe(true);
      await run.click();
      expect(run.calls.opens).toEqual([]);
      expect(run.switches()).toBe(0);
    }
    // Firefox: the learner registers no toolbar listener of its own.
    expect(harness({ withSidePanel: false }).listeners).toEqual([]);
  });

  test("the side panel page talking to the worker verifies the browser", async () => {
    const run = harness();
    await run.learner.load();
    // The options page shows the same file in a tab; the popup is another
    // file; another extension is not this one.
    for (const sender of [
      { id: "bramble", tab: { id: 3 }, url: PANEL_URL },
      { id: "bramble", url: "chrome-extension://bramble/popup.html" },
      { id: "other", url: PANEL_URL },
      undefined,
    ]) {
      run.learner.observeSender(sender);
      expect(run.learner.state()).toBe("unknown");
    }
    run.learner.observeSender({ id: "bramble", url: `${PANEL_URL}?view=home` });
    expect(run.learner.state()).toBe("verified");
    expect(run.calls.reconfigures).toBeGreaterThan(0);
  });

  test("with no side panel URL no sender can verify the browser", async () => {
    const learner = createSidePanelLearner({
      browser: { action: { onClicked: { addListener: () => undefined } } },
      extensionId: "bramble",
      preference: () => "side-panel",
      reconfigure: () => undefined,
      restoreSidePanel: async () => undefined,
      sidePanelUrl: "",
      store: () => createMemoryStore(),
      switchToPopup: async () => undefined,
      wait: async () => undefined,
    });
    await learner.load();
    learner.observeSender({ id: "bramble", url: PANEL_URL });
    expect(learner.state()).toBe("unknown");
  });

  test("the notice shows once and its dismissal is kept", async () => {
    const run = harness();
    await run.learner.load();
    await run.click();
    expect(run.learner.notice()).toBe(true);
    await run.learner.dismissNotice();
    await run.learner.dismissNotice();
    expect(run.learner.notice()).toBe(false);
    expect(await run.stored()).toEqual({ automatic: true, notice: false, state: "unsupported" });
  });

  test("a side panel that renders after an automatic switch undoes it", async () => {
    // A slow Chrome machine: the panel loaded after the wait, so the popup
    // switch was wrong. Its later render restores the side panel.
    for (const late of ["sender", "restart"] as const) {
      const store = createMemoryStore();
      const run = harness({ store });
      await run.learner.load();
      await run.click();
      expect(run.learner.state()).toBe("unsupported");
      run.render();
      if (late === "sender") {
        run.learner.observeSender({ id: "bramble", url: PANEL_URL });
        await run.settle();
      } else {
        const restarted = harness({ preference: "popup", store });
        restarted.render();
        await restarted.learner.load();
        expect(restarted.restores()).toBe(1);
        expect(restarted.learner.state()).toBe("verified");
        expect(restarted.learner.nativeClick()).toBe(true);
        continue;
      }
      expect(run.restores()).toBe(1);
      expect(run.learner.state()).toBe("verified");
      expect(run.learner.notice()).toBe(false);
      expect(run.learner.nativeClick()).toBe(true);
      expect(await run.stored()).toEqual({ automatic: false, notice: false, state: "verified" });
    }
  });

  test("a popup the user chose in Settings is never undone by a panel render", async () => {
    const run = harness();
    await run.learner.load();
    await run.click();
    run.learner.userChose();
    expect(run.learner.notice()).toBe(false);
    expect(await run.stored()).toEqual({ automatic: false, notice: false, state: "unsupported" });
    run.render();
    run.learner.observeSender({ id: "bramble", url: PANEL_URL });
    await run.settle();
    expect(run.restores()).toBe(0);
    expect(run.learner.state()).toBe("verified");
    // A choice made before the stored switch loads counts the same way.
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, {
      automatic: true,
      notice: true,
      state: "unsupported",
    });
    const early = harness({ preference: "popup", store });
    early.learner.userChose();
    early.render();
    await early.learner.load();
    expect(early.restores()).toBe(0);
  });

  test("a restore that can't be saved keeps the working popup and retries later", async () => {
    const run = harness({ restoreFails: true });
    await run.learner.load();
    await run.click();
    run.render();
    run.learner.observeSender({ id: "bramble", url: PANEL_URL });
    await run.settle();
    expect(run.learner.state()).toBe("unsupported");
    expect(run.learner.notice()).toBe(true);
    expect(await run.stored()).toEqual({ automatic: true, notice: true, state: "unsupported" });
  });

  test("an older stored switch without the automatic flag is treated as the user's", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, { notice: true, state: "unsupported" });
    const run = harness({ preference: "popup", store });
    run.render();
    await run.learner.load();
    expect(run.restores()).toBe(0);
    expect(run.learner.state()).toBe("verified");
  });
});
