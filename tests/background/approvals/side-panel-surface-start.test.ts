/**
 * Starting and configuring the request surface (#690): the worker starts the
 * surface exactly once whether or not the stored choice could be read, and
 * every toolbar configuration applies the latest surface, one at a time, with
 * one retry, so a stale popup can't hide the click that would repair it.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
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
    run.render();
    await run.sidePanelTalks();
    expect(run.learner.state()).toBe("verified");
    expect(run.toolbar()).toEqual({ native: true, popup: "" });
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
