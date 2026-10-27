/**
 * Side-panel learning transitions (#690): automatic surface changes are
 * journaled before the preference changes and reconciled at start, a newer
 * user choice or panel render outranks an automatic write still in flight, and
 * the notice commands answer only this extension's own pages.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { SIDE_PANEL_LEARNING_STORE_KEY } from "../../../apps/extension/src/background/approvals/side-panel-learning";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import {
  contentSender,
  createWallet,
  extensionSender,
  testExtension,
} from "../../support/background-wallet-stub";
import { learningHarness, settleAll } from "../../support/side-panel-learning-harness";

const ARC_SWITCH = { automatic: true, notice: true, state: "unsupported" };
const VERIFIED = { automatic: false, notice: false, state: "verified" };

// An Arc-like click that reaches the point where the popup save is held.
const switchHeld = async (run: ReturnType<typeof learningHarness>) => {
  await run.learner.load();
  run.hold();
  await run.click();
  expect(run.calls.saves).toEqual(["popup"]);
};

describe("an automatic switch overtaken while it is being written", () => {
  test("a side panel render during the popup save keeps the side panel", async () => {
    const run = learningHarness();
    await switchHeld(run);
    run.render();
    await run.sidePanelTalks();
    await run.release();
    // The overtaken switch puts the side panel back itself: one write, not a
    // second revert queued behind it.
    expect(run.calls.saves).toEqual(["popup", "side-panel"]);
    expect(run.saved()).toBe("side-panel");
    expect(run.preference()).toBe("side-panel");
    expect(run.learner.state()).toBe("verified");
    expect(run.learner.nativeClick()).toBe(true);
    expect(await run.learner.notice()).toBe(false);
    expect(await run.stored()).toEqual(VERIFIED);
    expect(run.calls.popups).toEqual([]);
  });

  test("a Settings choice during the popup save wins over the stale write", async () => {
    for (const choice of ["side-panel", "popup"] as const) {
      const run = learningHarness();
      await switchHeld(run);
      run.userChooses(choice);
      await run.release();
      expect(run.saved()).toBe(choice);
      expect(run.preference()).toBe(choice);
      expect(run.learner.state()).toBe("unsupported");
      expect(await run.learner.notice()).toBe(false);
      expect(await run.stored()).toEqual({ automatic: false, notice: false, state: "unsupported" });
      expect(run.calls.popups).toEqual([]);
      // The user's choice is never undone by a later render.
      run.render();
      await run.sidePanelTalks();
      expect(run.saved()).toBe(choice);
    }
  });

  test("a Settings choice during an automatic revert wins over it", async () => {
    const run = learningHarness();
    await run.learner.load();
    await run.click();
    run.hold();
    run.render();
    await run.sidePanelTalks();
    expect(run.calls.saves).toEqual(["popup", "side-panel"]);
    run.userChooses("popup");
    await run.release();
    expect(run.saved()).toBe("popup");
    expect(run.preference()).toBe("popup");
    expect(run.learner.state()).toBe("verified");
    expect(await run.stored()).toEqual(VERIFIED);
  });
});

describe("self-healing across a restart", () => {
  test("a panel already open when the worker restarts undoes an automatic switch", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, ARC_SWITCH);
    const run = learningHarness({ preference: "popup", store });
    run.render();
    await run.learner.load();
    await settleAll();
    expect(run.saved()).toBe("side-panel");
    expect(run.learner.state()).toBe("verified");
    expect(run.learner.nativeClick()).toBe(true);
    expect(await store.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual(VERIFIED);
  });

  test("a switch the user kept is only marked verified at restart, never undone", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, {
      ...ARC_SWITCH,
      automatic: false,
      notice: false,
    });
    const run = learningHarness({ preference: "popup", store });
    run.render();
    await run.learner.load();
    await settleAll();
    expect(run.calls.saves).toEqual([]);
    expect(run.saved()).toBe("popup");
    expect(run.learner.state()).toBe("verified");
  });
});

describe("partial commits", () => {
  test("a journal that can't be written changes nothing", async () => {
    const run = learningHarness({ writeFails: () => true });
    await run.learner.load();
    await run.click();
    expect(run.calls.saves).toEqual([]);
    expect(run.saved()).toBe("side-panel");
    expect(run.learner.state()).toBe("unknown");
  });

  test("an outcome that can't be recorded is recovered from the journal at the next start", async () => {
    const store = createMemoryStore();
    // Every write after the journal fails.
    let writes = 0;
    const run = learningHarness({ store, writeFails: () => ++writes > 1 });
    await run.learner.load();
    await run.click();
    expect(run.saved()).toBe("popup");
    expect(await store.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual({
      automatic: false,
      notice: false,
      pending: "popup",
      state: "unknown",
    });
    const restarted = learningHarness({ preference: "popup", store });
    await restarted.learner.load();
    expect(restarted.learner.state()).toBe("unsupported");
    expect(await store.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual(ARC_SWITCH);
    // Self-healing still works: a slow Chrome's late render restores the panel.
    restarted.render();
    await restarted.sidePanelTalks();
    expect(restarted.saved()).toBe("side-panel");
    expect(restarted.learner.state()).toBe("verified");
  });

  test("a worker stopped between the journal and the preference write leaves no switch", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, {
      automatic: false,
      notice: false,
      pending: "popup",
      state: "unknown",
    });
    const run = learningHarness({ preference: "side-panel", store });
    await run.learner.load();
    expect(run.learner.state()).toBe("unknown");
    expect(await store.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual({
      automatic: false,
      notice: false,
      state: "unknown",
    });
  });

  test("a worker stopped mid-revert finishes it, or keeps the automatic switch", async () => {
    for (const [preference, expected] of [
      ["side-panel", VERIFIED],
      ["popup", ARC_SWITCH],
    ] as const) {
      const store = createMemoryStore();
      await store.set(SIDE_PANEL_LEARNING_STORE_KEY, { ...ARC_SWITCH, pending: "side-panel" });
      const run = learningHarness({ preference, store });
      await run.learner.load();
      expect(await store.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual(expected);
    }
  });

  test("a toolbar the browser refuses to configure is retried, then repaired on the next click", async () => {
    let refusals = 2;
    const run = learningHarness({ applyFails: () => refusals-- > 0 });
    await run.learner.load();
    await run.click();
    // Saved and recorded, but both attempts to apply the popup were refused.
    expect(run.saved()).toBe("popup");
    expect(run.calls.applied).toEqual([]);
    expect(await run.stored()).toEqual(ARC_SWITCH);
    // With no popup applied the click reaches the listener again: reapply it.
    await run.click();
    expect(run.calls.applied).toEqual(["popup"]);
    expect(run.calls.popups.length).toBeGreaterThan(0);
  });

  test("a refused restore keeps the working popup and retries on the next render", async () => {
    const run = learningHarness({ saveFails: (surface) => surface === "side-panel" });
    await run.learner.load();
    await run.click();
    run.render();
    await run.sidePanelTalks();
    expect(run.saved()).toBe("popup");
    expect(run.learner.state()).toBe("unsupported");
    expect(await run.stored()).toEqual(ARC_SWITCH);
  });
});

describe("side panel notice commands through the router", () => {
  const handler = (notice: boolean) =>
    createMessageHandler(createWallet(), testExtension, {
      sidePanelLearning: { dismissNotice: async () => undefined, notice: async () => notice },
    });

  test("answer this extension's pages only", async () => {
    const run = handler(true);
    expect(await run({ type: "wallet.sidePanelNotice" }, extensionSender)).toEqual({
      notice: true,
      ok: true,
    });
    expect(await run({ type: "wallet.dismissSidePanelNotice" }, extensionSender)).toEqual({
      ok: true,
    });
    const foreign = { id: "other-extension", url: "chrome-extension://other-extension/x.html" };
    for (const sender of [contentSender, foreign, undefined]) {
      for (const type of ["wallet.sidePanelNotice", "wallet.dismissSidePanelNotice"]) {
        const response = (await run({ type }, sender as never)) as Record<string, unknown>;
        expect(response["ok"]).toBeUndefined();
        expect(typeof response["error"]).toBe("string");
      }
    }
    await settleAll();
  });
});
