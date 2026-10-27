/**
 * Side-panel learning (#690). Arc exposes `chrome.sidePanel` and `open()`
 * resolves, but no panel is ever drawn. A toolbar click is the only teacher:
 * a side panel seen means the built-in behavior for good (Chrome), none seen
 * after a resolved open means the side panel is served as the popup (Arc). The
 * learner writes only its own record. No path here opens a window, and every
 * unknown answer keeps today's behavior.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import {
  createSidePanelLearner,
  SIDE_PANEL_LEARN_TIMEOUT_MS,
  SIDE_PANEL_LEARNING_STORE_KEY,
} from "../../../apps/extension/src/background/approvals/side-panel-learning";
import { PANEL_URL, settleAll, surfaceHarness } from "../../support/side-panel-learning-harness";

const UNSUPPORTED = { notice: true, state: "unsupported" };
const VERIFIED = { notice: false, state: "verified" };

describe("side-panel learning", () => {
  test("keeps the built-in toolbar behavior until it has loaded", () => {
    const run = surfaceHarness();
    expect(run.learner.nativeClick()).toBe(true);
    expect(run.toolbar()).toEqual({ native: true, popup: "" });
  });

  test("a side panel that loads verifies the browser and restores the built-in behavior", async () => {
    const run = surfaceHarness({ contexts: 2 });
    await run.load();
    expect(run.toolbar().native).toBe(false);
    await run.click();
    expect(run.calls.opens).toEqual([7]);
    expect(run.learner.state()).toBe("verified");
    expect(run.toolbar()).toEqual({ native: true, popup: "" });
    expect(await run.stored()).toEqual(VERIFIED);
    expect(run.calls.popups).toEqual([]);
  });

  test("a resolved open with no panel serves the side panel as the popup", async () => {
    const run = surfaceHarness();
    await run.load();
    await run.click();
    expect(run.calls.opens).toEqual([7]);
    // The whole window was watched before deciding.
    expect(run.calls.queries).toBeGreaterThan(SIDE_PANEL_LEARN_TIMEOUT_MS / 250);
    expect(run.learner.state()).toBe("unsupported");
    expect(await run.stored()).toEqual(UNSUPPORTED);
    expect(run.control.effective()).toBe("popup");
    expect(run.toolbar()).toEqual({ native: false, popup: "popup.html" });
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
    // The user's own choice is untouched.
    expect(run.control.preference()).toBe("side-panel");
    expect(await run.learner.notice()).toBe(true);
  });

  test("a cold worker woken by the click opens the panel first, then learns from it", async () => {
    const run = surfaceHarness();
    // Nothing is loaded yet.
    run.clickNow();
    expect(run.calls.opens).toEqual([7]);
    expect(run.calls.queries).toBe(0);
    await run.load();
    expect(run.learner.state()).toBe("unsupported");
  });

  test("a click with the popup in effect means applying it failed: reapply and open it", async () => {
    const run = surfaceHarness({ preference: "popup" });
    await run.load();
    const configured = run.calls.popupSet.length;
    await run.click();
    expect(run.calls.popupSet.length).toBeGreaterThan(configured);
    expect(run.toolbar().popup).toBe("popup.html");
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
    expect(run.learner.state()).toBe("unknown");
  });

  test("a refused open or a failed context query learns nothing", async () => {
    for (const options of [{ openRejects: true }, { contexts: "fail" as const }]) {
      const run = surfaceHarness(options);
      await run.load();
      await run.click();
      expect(run.learner.state()).toBe("unknown");
      expect(run.control.effective()).toBe("side-panel");
      expect(run.calls.popups).toEqual([]);
      expect(await run.stored()).toBeUndefined();
    }
  });

  test("a click with no window opens nothing", async () => {
    const run = surfaceHarness();
    await run.load();
    for (const listener of run.listeners) {
      listener({});
      listener(undefined);
    }
    await settleAll();
    expect(run.calls.opens).toEqual([]);
  });

  test("a second click while one is being learned opens the panel but learns once", async () => {
    const run = surfaceHarness();
    await run.load();
    run.clickNow();
    run.clickNow();
    await settleAll();
    expect(run.calls.opens).toEqual([7, 7]);
    const single = surfaceHarness();
    await single.load();
    await single.click();
    expect(run.calls.queries).toBe(single.calls.queries);
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
  });

  test("a panel already open when the worker starts verifies the browser", async () => {
    const run = surfaceHarness({ contexts: 0 });
    await run.load();
    expect(run.learner.state()).toBe("verified");
    expect(run.toolbar().native).toBe(true);
  });

  test("what was learned before is kept across worker restarts", async () => {
    for (const [stored, effective, native] of [
      [VERIFIED, "side-panel", true],
      [UNSUPPORTED, "popup", false],
      [{ state: "bogus" }, "side-panel", false],
      [null, "side-panel", false],
    ] as const) {
      const store = createMemoryStore();
      if (stored) await store.set(SIDE_PANEL_LEARNING_STORE_KEY, stored);
      const run = surfaceHarness({ store });
      await run.load();
      expect(run.control.effective()).toBe(effective);
      expect(run.toolbar().native).toBe(native);
    }
  });

  test("no storage or an unreadable store opens the panel but learns nothing", async () => {
    const unreadable = createMemoryStore();
    const failing: KeyValueStore = {
      ...unreadable,
      get: async () => {
        throw new Error("corrupt");
      },
    };
    for (const store of [null, "throws" as const, failing]) {
      const run = surfaceHarness({ store });
      await run.load();
      expect(run.toolbar().native).toBe(true);
      await run.click();
      expect(run.calls.opens).toEqual([7]);
      // Nothing is watched, and a panel seen writes nothing over the store.
      expect(run.calls.queries).toBe(0);
      run.render();
      await run.sidePanelTalks();
      expect(run.learner.state()).not.toBe("unsupported");
      expect(run.control.effective()).toBe("side-panel");
      expect(run.toolbar().native).toBe(true);
    }
    expect(await unreadable.get(SIDE_PANEL_LEARNING_STORE_KEY)).toBeUndefined();
    // Firefox: the learner registers no toolbar listener of its own.
    expect(surfaceHarness({ withSidePanel: false }).listeners).toEqual([]);
  });

  test("the side panel page talking to the worker verifies the browser", async () => {
    const run = surfaceHarness();
    await run.load();
    // The options page shows the same file in a tab; the popup is another
    // file; another extension is not this one.
    for (const sender of [
      { id: "bramble", tab: { id: 3 }, url: PANEL_URL },
      { id: "bramble", url: "chrome-extension://bramble/popup.html" },
      { id: "other", url: PANEL_URL },
      undefined,
    ]) {
      run.learner.observeSender(sender);
      await settleAll();
      expect(run.learner.state()).toBe("unknown");
    }
    run.learner.observeSender({ id: "bramble", url: `${PANEL_URL}?view=home` });
    await settleAll();
    expect(run.learner.state()).toBe("verified");
    expect(run.toolbar().native).toBe(true);
  });

  test("with no side panel URL no sender can verify the browser", async () => {
    const learner = createSidePanelLearner({
      browser: { action: { onClicked: { addListener: () => undefined } } },
      configure: async () => undefined,
      extensionId: "bramble",
      sidePanelUrl: "",
      store: () => createMemoryStore(),
      surface: () => "side-panel",
      wait: async () => undefined,
    });
    await learner.load();
    learner.observeSender({ id: "bramble", url: PANEL_URL });
    await settleAll();
    expect(learner.state()).toBe("unknown");
  });

  test("the notice shows once and its dismissal is kept", async () => {
    const run = surfaceHarness();
    await run.load();
    await run.click();
    expect(await run.learner.notice()).toBe(true);
    await run.learner.dismissNotice();
    await run.learner.dismissNotice();
    expect(await run.learner.notice()).toBe(false);
    expect(await run.stored()).toEqual({ ...UNSUPPORTED, notice: false });
  });

  test("a dismissal that can't be stored still hides the notice for this session", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, UNSUPPORTED);
    const run = surfaceHarness({ store, writeFails: () => true });
    await run.load();
    await run.learner.dismissNotice();
    expect(await run.learner.notice()).toBe(false);
    expect(run.control.effective()).toBe("popup");
  });

  test("a notice read before the stored state loads waits for it", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, UNSUPPORTED);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: KeyValueStore = {
      ...store,
      get: async (key) => {
        await gate;
        return store.get(key);
      },
    };
    const run = surfaceHarness({ store: slow });
    const early = run.learner.notice();
    const loading = run.load();
    release();
    await loading;
    expect(await early).toBe(true);
  });
});
