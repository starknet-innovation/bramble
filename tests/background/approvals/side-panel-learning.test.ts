/**
 * Side-panel learning (#690). Arc exposes `chrome.sidePanel` and `open()`
 * resolves, but no panel is ever drawn. A toolbar click is the only teacher:
 * a side panel seen means the built-in behavior for good (Chrome), none seen
 * after a resolved open means a switch to the compact popup (Arc), undone if a
 * real panel renders later. No path here opens a window, and every unknown
 * answer keeps today's behavior.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import {
  createSidePanelLearner,
  SIDE_PANEL_LEARN_TIMEOUT_MS,
  SIDE_PANEL_LEARNING_STORE_KEY,
} from "../../../apps/extension/src/background/approvals/side-panel-learning";
import { learningHarness, PANEL_URL, settleAll } from "../../support/side-panel-learning-harness";

const ARC_SWITCH = { automatic: true, notice: true, state: "unsupported" };

describe("side-panel learning", () => {
  test("keeps the built-in toolbar behavior until it has loaded", () => {
    expect(learningHarness().learner.nativeClick()).toBe(true);
  });

  test("a side panel that loads verifies the browser and restores the built-in behavior", async () => {
    const run = learningHarness({ contexts: 2 });
    await run.learner.load();
    expect(run.learner.nativeClick()).toBe(false);
    await run.click();
    expect(run.calls.opens).toEqual([7]);
    expect(run.learner.state()).toBe("verified");
    expect(run.learner.nativeClick()).toBe(true);
    expect(await run.stored()).toEqual({ automatic: false, notice: false, state: "verified" });
    expect(run.calls.saves).toEqual([]);
    expect(run.calls.popups).toEqual([]);
  });

  test("a resolved open with no panel switches to the popup once and opens it", async () => {
    const run = learningHarness();
    await run.learner.load();
    await run.click();
    expect(run.calls.opens).toEqual([7]);
    // The whole window was watched before deciding.
    expect(run.calls.queries).toBeGreaterThan(SIDE_PANEL_LEARN_TIMEOUT_MS / 250);
    expect(run.calls.saves).toEqual(["popup"]);
    expect(run.saved()).toBe("popup");
    expect(run.calls.applied).toEqual(["popup"]);
    expect(run.learner.state()).toBe("unsupported");
    expect(await run.learner.notice()).toBe(true);
    expect(await run.stored()).toEqual(ARC_SWITCH);
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
  });

  test("a cold worker woken by the click opens the panel first, then learns from it", async () => {
    const run = learningHarness();
    // Nothing is loaded yet, and the built-in panel click is already off.
    run.clickNow();
    expect(run.calls.opens).toEqual([7]);
    expect(run.calls.queries).toBe(0);
    await run.learner.load();
    await settleAll();
    expect(run.calls.saves).toEqual(["popup"]);
    expect(run.learner.state()).toBe("unsupported");
  });

  test("a click with the popup as the surface means applying it failed: reapply and open it", async () => {
    const run = learningHarness({ preference: "popup" });
    await run.learner.load();
    await run.click();
    expect(run.calls.applied).toEqual(["popup"]);
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
    expect(run.calls.saves).toEqual([]);
    expect(run.learner.state()).toBe("unknown");
  });

  test("never overrides the user's later choice of the side panel", async () => {
    const run = learningHarness();
    await run.learner.load();
    await run.click();
    run.userChooses("side-panel");
    expect(run.learner.nativeClick()).toBe(true);
    expect(await run.learner.notice()).toBe(false);
    await run.click();
    expect(run.calls.saves).toEqual(["popup"]);
    expect(run.saved()).toBe("side-panel");
  });

  test("a refused open, a failed context query or an unsaved choice switches nothing", async () => {
    for (const options of [
      { openRejects: true },
      { contexts: "fail" as const },
      { saveFails: () => true },
    ]) {
      const run = learningHarness(options);
      await run.learner.load();
      await run.click();
      expect(run.saved()).toBe("side-panel");
      expect(run.learner.state()).toBe("unknown");
      expect(await run.learner.notice()).toBe(false);
      expect(run.calls.popups).toEqual([]);
      // Nothing journaled is left behind: either nothing was written, or the
      // journal was cleared after the save failed.
      const stored = await run.stored();
      if (stored !== undefined) {
        expect(stored).toEqual({ automatic: false, notice: false, state: "unknown" });
      }
    }
  });

  test("a click with no window opens nothing", async () => {
    const run = learningHarness();
    await run.learner.load();
    for (const listener of run.listeners) {
      listener({});
      listener(undefined);
    }
    await settleAll();
    expect(run.calls.opens).toEqual([]);
  });

  test("a second click while one is being learned opens the panel but learns once", async () => {
    const run = learningHarness();
    await run.learner.load();
    run.clickNow();
    run.clickNow();
    await settleAll();
    expect(run.calls.opens).toEqual([7, 7]);
    expect(run.calls.saves).toEqual(["popup"]);
    const single = learningHarness();
    await single.learner.load();
    await single.click();
    expect(run.calls.queries).toBe(single.calls.queries);
  });

  test("a panel already open when the worker starts verifies the browser", async () => {
    const run = learningHarness({ contexts: 0 });
    await run.learner.load();
    await settleAll();
    expect(run.learner.state()).toBe("verified");
    expect(run.learner.nativeClick()).toBe(true);
  });

  test("what was learned before is kept across worker restarts", async () => {
    for (const [stored, native] of [
      [{ automatic: false, notice: false, state: "verified" }, true],
      [{ automatic: false, notice: true, state: "unsupported" }, true],
      [{ state: "bogus" }, false],
      [null, false],
    ] as const) {
      const store = createMemoryStore();
      if (stored) await store.set(SIDE_PANEL_LEARNING_STORE_KEY, stored);
      const run = learningHarness({ preference: "popup", store });
      await run.learner.load();
      expect(run.learner.nativeClick()).toBe(native);
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
      const run = learningHarness({ store });
      await run.learner.load();
      expect(run.learner.nativeClick()).toBe(true);
      await run.click();
      expect(run.calls.opens).toEqual([7]);
      expect(run.calls.saves).toEqual([]);
    }
    // Firefox: the learner registers no toolbar listener of its own.
    expect(learningHarness({ withSidePanel: false }).listeners).toEqual([]);
  });

  test("the side panel page talking to the worker verifies the browser", async () => {
    const run = learningHarness();
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
      await settleAll();
      expect(run.learner.state()).toBe("unknown");
    }
    run.learner.observeSender({ id: "bramble", url: `${PANEL_URL}?view=home` });
    await settleAll();
    expect(run.learner.state()).toBe("verified");
    expect(run.calls.reconfigures).toBeGreaterThan(0);
  });

  test("with no side panel URL no sender can verify the browser", async () => {
    const learner = createSidePanelLearner({
      applySurface: async () => undefined,
      browser: { action: { onClicked: { addListener: () => undefined } } },
      extensionId: "bramble",
      preference: () => "side-panel",
      reconfigure: () => undefined,
      saveSurface: async () => undefined,
      sidePanelUrl: "",
      store: () => createMemoryStore(),
      wait: async () => undefined,
    });
    await learner.load();
    learner.observeSender({ id: "bramble", url: PANEL_URL });
    await settleAll();
    expect(learner.state()).toBe("unknown");
  });

  test("the notice shows once and its dismissal is kept", async () => {
    const run = learningHarness();
    await run.learner.load();
    await run.click();
    expect(await run.learner.notice()).toBe(true);
    await run.learner.dismissNotice();
    await run.learner.dismissNotice();
    expect(await run.learner.notice()).toBe(false);
    expect(await run.stored()).toEqual({ ...ARC_SWITCH, notice: false });
  });

  test("a notice read before the stored state loads waits for it", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, ARC_SWITCH);
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
    const run = learningHarness({ preference: "popup", store: slow });
    const early = run.learner.notice();
    const loading = run.learner.load();
    release();
    await loading;
    expect(await early).toBe(true);
  });
});
