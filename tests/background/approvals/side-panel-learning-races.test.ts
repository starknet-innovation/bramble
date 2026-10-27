/**
 * The four races the first design had (#690), each impossible now that the
 * learner writes only its own record: a choice saved while a record write is
 * held, a failed write after a panel was seen, a choice read back as the
 * learner's own, and a choice made before the record loads. Plus a restart at
 * every step, which must derive the same surface from what is on disk.
 */
import { describe, expect, test } from "bun:test";
import type { ApprovalSurfacePreference } from "@bramble/settings/preferences";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { SIDE_PANEL_LEARNING_STORE_KEY } from "../../../apps/extension/src/background/approvals/side-panel-learning";
import { settleAll, surfaceHarness } from "../../support/side-panel-learning-harness";

const UNSUPPORTED = { notice: true, state: "unsupported" };

// A store whose learning-record writes wait until released.
const heldStore = () => {
  const base = createMemoryStore();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store: KeyValueStore = {
    ...base,
    set: async (key, value) => {
      if (key === SIDE_PANEL_LEARNING_STORE_KEY) await held;
      return base.set(key, value);
    },
  };
  return { base, release, store };
};

describe("a choice saved while a learning write is held", () => {
  test("stands: the popup chosen mid-write is never replaced", async () => {
    const { base, release, store } = heldStore();
    const run = surfaceHarness({ store });
    await run.load();
    await run.click();
    // The "unsupported" write is still held.
    expect(run.learner.state()).toBe("unknown");
    run.userChooses("popup");
    release();
    await settleAll();
    expect(run.control.preference()).toBe("popup");
    expect(run.control.effective()).toBe("popup");
    expect(await base.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual(UNSUPPORTED);
    // Healing the record leaves the user's choice alone too.
    run.render();
    await run.sidePanelTalks();
    expect(run.control.preference()).toBe("popup");
    expect(run.toolbar().popup).toBe("popup.html");
  });

  test("the side panel chosen mid-write is a retry queued after it", async () => {
    const { base, release, store } = heldStore();
    const run = surfaceHarness({ store });
    await run.load();
    await run.click();
    run.userChooses("side-panel");
    release();
    await settleAll();
    expect(run.control.preference()).toBe("side-panel");
    expect(run.learner.state()).toBe("unknown");
    expect(await base.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual({
      notice: false,
      state: "unknown",
    });
  });
});

describe("a failed write after a side panel was seen", () => {
  test("serves the side panel now and leaves one coherent record behind", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, UNSUPPORTED);
    const run = surfaceHarness({
      store,
      writeFails: (value) => (value as { state?: string }).state === "verified",
    });
    await run.load();
    expect(run.control.effective()).toBe("popup");
    run.render();
    await run.sidePanelTalks();
    // Today's behavior: the user's side panel, opened natively.
    expect(run.control.effective()).toBe("side-panel");
    expect(run.toolbar()).toEqual({ native: true, popup: "" });
    expect(run.control.preference()).toBe("side-panel");
    // Nothing else was written, so a restart reads the old record as is.
    expect(await store.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual(UNSUPPORTED);
    const restarted = surfaceHarness({ store });
    await restarted.load();
    expect(restarted.control.preference()).toBe("side-panel");
    expect(restarted.control.effective()).toBe("popup");
    // And the user can still ask for the side panel again.
    restarted.userChooses("side-panel");
    await settleAll();
    expect(restarted.control.effective()).toBe("side-panel");
  });
});

describe("a choice made before the record loads", () => {
  test("is kept by the load, whatever was learned", async () => {
    for (const [stored, choice, effective, state] of [
      [null, "popup", "popup", "unknown"],
      [UNSUPPORTED, "popup", "popup", "unsupported"],
      // Choosing the side panel where it was learned unsupported: try again.
      [UNSUPPORTED, "side-panel", "side-panel", "unknown"],
    ] as const) {
      const store = createMemoryStore();
      if (stored) await store.set(SIDE_PANEL_LEARNING_STORE_KEY, stored);
      const run = surfaceHarness({ store });
      run.userChooses(choice);
      await run.load();
      expect(run.control.preference()).toBe(choice);
      expect(run.control.effective()).toBe(effective);
      expect(run.learner.state()).toBe(state);
    }
  });
});

describe("a restart at any step", () => {
  test("derives the same surface from what was stored", async () => {
    const store = createMemoryStore();
    const preference: ApprovalSurfacePreference = "side-panel";
    const run = surfaceHarness({ preference, store });
    const restartAgrees = async () => {
      await settleAll();
      const restarted = surfaceHarness({ preference, store });
      await restarted.load();
      expect(restarted.control.effective()).toBe(run.control.effective());
      expect(restarted.learner.state()).toBe(run.learner.state());
      expect(await restarted.learner.notice()).toBe(await run.learner.notice());
    };
    await run.load();
    await restartAgrees();
    // Mid-window: nothing is written yet, so a restart learns afresh.
    let midWindow: Promise<void> = Promise.resolve();
    run.onWatch(() => {
      midWindow = restartAgrees();
    });
    await run.click();
    await midWindow;
    expect(run.learner.state()).toBe("unsupported");
    await restartAgrees();
    await run.learner.dismissNotice();
    await restartAgrees();
    run.userChooses("side-panel");
    await restartAgrees();
    run.render();
    await run.sidePanelTalks();
    expect(run.learner.state()).toBe("verified");
    await restartAgrees();
  });
});
