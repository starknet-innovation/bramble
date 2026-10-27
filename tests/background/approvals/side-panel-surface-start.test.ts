/**
 * Starting and configuring the request surface (#690): the worker starts the
 * surface exactly once whether or not the stored choice could be read, and
 * every toolbar configuration applies the latest surface, one at a time, with
 * one retry, so a stale popup can't hide the click that would repair it.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { createApprovalSurfaceControl } from "../../../apps/extension/src/background/approvals/approval-surface-control";
import { SIDE_PANEL_LEARNING_STORE_KEY } from "../../../apps/extension/src/background/approvals/side-panel-learning";
import { settleAll, surfaceHarness } from "../../support/side-panel-learning-harness";

const UNSUPPORTED = { notice: true, state: "unsupported" };

describe("starting the surface", () => {
  test("a failed read of the stored choice still loads, on the side panel", async () => {
    const run = surfaceHarness({ read: () => Promise.reject(new Error("unreadable")) });
    const notice = run.learner.notice();
    await run.load();
    expect(await notice).toBe(false);
    expect(run.learner.loaded()).toBe(true);
    expect(run.control.preference()).toBe("side-panel");
    // The toolbar was configured, and a click still learns.
    expect(run.toolbar()).toEqual({ native: false, popup: "" });
    await run.click();
    expect(run.learner.state()).toBe("unsupported");
  });

  test("runs once, however often it is asked", async () => {
    const base = createMemoryStore();
    let reads = 0;
    const store: KeyValueStore = {
      ...base,
      get: async (key) => {
        reads += 1;
        return base.get(key);
      },
    };
    const run = surfaceHarness({ store });
    await run.load();
    await run.control.start(Promise.resolve("popup"));
    await settleAll();
    expect(reads).toBe(1);
    expect(run.control.preference()).toBe("side-panel");
  });

  test("the background starts it from every outcome of the preferences read", async () => {
    const source = await readFile("apps/extension/src/background/index.ts", "utf8");
    expect(source.match(/approvalSurface\.start\(/g)).toHaveLength(1);
    // Read through a promise that can't skip the start: a rejecting read
    // still reaches it, as the failed-read case above.
    expect(source).toMatch(/approvalSurface\.start\(reading\.then\(/);
    expect(source).not.toMatch(/approvalSurface\.(apply|load)\(/);
  });
});

describe("toolbar configuration", () => {
  const unsupported = async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, UNSUPPORTED);
    return store;
  };

  test("a refused popup clear after 'try again' is retried", async () => {
    let refusals = 0;
    const run = surfaceHarness({
      configureFails: () => refusals-- > 0,
      store: await unsupported(),
    });
    await run.load();
    expect(run.toolbar().popup).toBe("popup.html");
    refusals = 1;
    run.userChooses("side-panel");
    await settleAll();
    expect(run.toolbar()).toEqual({ native: false, popup: "" });
    // So the next click reaches the learner again.
    await run.click();
    expect(run.calls.opens).toEqual([7]);
  });

  test("a refused popup clear after a self-heal is retried", async () => {
    let refusals = 0;
    const run = surfaceHarness({
      configureFails: () => refusals-- > 0,
      store: await unsupported(),
    });
    await run.load();
    refusals = 1;
    await run.sidePanelShows();
    expect(run.learner.state()).toBe("verified");
    expect(run.toolbar()).toEqual({ native: true, popup: "" });
  });

  test("without storage, a click repairs the popup the user chose", async () => {
    // Both configuration attempts at start are refused, so no popup is set.
    let refusals = 2;
    const run = surfaceHarness({
      configureFails: () => refusals-- > 0,
      preference: "popup",
      store: null,
    });
    await run.load();
    expect(run.toolbar().popup).toBe("");
    await run.click();
    expect(run.toolbar().popup).toBe("popup.html");
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
    expect(run.calls.waits).toBe(0);
  });

  test("a popup left by a double refusal is repaired by the next worker start", async () => {
    const store = await unsupported();
    let refuse = false;
    const run = surfaceHarness({ configureFails: () => refuse, store });
    await run.load();
    // Every attempt now is refused, the retry included.
    refuse = true;
    run.userChooses("side-panel");
    await settleAll();
    // Stale for this worker: the popup still hides the learning click.
    expect(run.toolbar().popup).toBe("popup.html");
    const restarted = surfaceHarness({ persisted: run.toolbar(), store });
    await restarted.load();
    expect(restarted.toolbar()).toEqual({ native: false, popup: "" });
    await restarted.click();
    expect(restarted.calls.opens).toEqual([7]);
  });

  test("a slow configuration can't land after a newer one", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const run = surfaceHarness({
      configureDelay: () => {
        if (!first) return undefined;
        first = false;
        return held;
      },
      store: await unsupported(),
    });
    // The load's popup is held; the user's "try again" follows it.
    await run.load();
    run.userChooses("side-panel");
    await settleAll();
    expect(run.calls.popupSet).toEqual([]);
    release();
    await settleAll();
    expect(run.calls.popupSet[0]).toBe("popup.html");
    expect(run.toolbar()).toEqual({ native: false, popup: "" });
  });
});

describe("opening the popup for the #707 rescue", () => {
  test("borrows the popup for the moment it opens, then restores the side panel", async () => {
    const run = surfaceHarness();
    await run.load();
    const before = run.calls.popupSet.length;
    await run.control.showPopup(7);
    expect(run.calls.shown).toEqual([7]);
    expect(run.calls.popupSet.slice(before)).toEqual(["popup.html", ""]);
    expect(run.toolbar()).toEqual({ native: false, popup: "" });
    // The learner is untouched, and nothing is stored.
    expect(run.learner.state()).toBe("unknown");
    expect(await run.stored()).toBeUndefined();
  });

  test("with the popup already in effect, opens it and changes nothing", async () => {
    const run = surfaceHarness({ preference: "popup" });
    await run.load();
    const before = run.calls.popupSet.length;
    await run.control.showPopup(7);
    expect(run.calls.popupSet.length).toBe(before);
    expect(run.calls.popups).toEqual([{ windowId: 7 }]);
  });

  test("a refused open still restores the toolbar, and rejects", async () => {
    const run = surfaceHarness({ popupRejects: true });
    await run.load();
    await expect(run.control.showPopup(7)).rejects.toThrow();
    expect(run.toolbar()).toEqual({ native: false, popup: "" });
    // The queue goes on: a later configuration still runs.
    run.userChooses("popup");
    await settleAll();
    expect(run.toolbar().popup).toBe("popup.html");
  });

  test("does nothing where the browser has no popup API", async () => {
    const control = createApprovalSurfaceControl({
      browser: undefined,
      extensionId: "bramble",
      now: () => 0,
      store: () => null,
      wait: async () => undefined,
    });
    await expect(control.showPopup(7)).resolves.toBeUndefined();
    await expect(control.rescue(7)).resolves.toBeUndefined();
  });

  test("a refused restore is retried once", async () => {
    // After load: the borrow is accepted, the first restore refused.
    let answers: boolean[] = [];
    const run = surfaceHarness({ configureFails: () => answers.shift() ?? false });
    await run.load();
    answers = [false, true];
    const before = run.calls.popupSet.length;
    await run.control.showPopup(7);
    expect(run.calls.popupSet.slice(before)).toEqual(["popup.html", ""]);
    expect(run.toolbar()).toEqual({ native: false, popup: "" });
  });
});
