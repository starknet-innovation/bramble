/**
 * The request surface in effect (#690) is derived from the user's choice and
 * the learner's one record, and nothing else. The learner never writes the
 * user's choice, a real side panel render corrects a wrong "unsupported" at
 * any time, an unwritable record falls back to today's behavior, and the
 * notice commands answer only this extension's own pages.
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
import { settleAll, surfaceHarness } from "../../support/side-panel-learning-harness";

const UNSUPPORTED = { notice: true, state: "unsupported" };
const VERIFIED = { notice: false, state: "verified" };

describe("the surface in effect", () => {
  test("is derived from the user's choice and what was learned", async () => {
    for (const [preference, stored, effective, toolbar] of [
      ["popup", null, "popup", { native: false, popup: "popup.html" }],
      ["popup", UNSUPPORTED, "popup", { native: false, popup: "popup.html" }],
      ["popup", VERIFIED, "popup", { native: false, popup: "popup.html" }],
      ["side-panel", null, "side-panel", { native: false, popup: "" }],
      ["side-panel", VERIFIED, "side-panel", { native: true, popup: "" }],
      ["side-panel", UNSUPPORTED, "popup", { native: false, popup: "popup.html" }],
    ] as const) {
      const store = createMemoryStore();
      if (stored) await store.set(SIDE_PANEL_LEARNING_STORE_KEY, stored);
      const run = surfaceHarness({ preference, store });
      await run.load();
      expect(run.control.effective()).toBe(effective);
      expect(run.toolbar()).toEqual(toolbar);
      expect(run.control.preference()).toBe(preference);
    }
  });

  test("the learner never writes the user's choice, whatever they choose and when", async () => {
    const run = surfaceHarness();
    await run.load();
    // A choice made in the middle of a learning window stands.
    run.onWatch(() => run.userChooses("popup"));
    await run.click();
    expect(run.control.preference()).toBe("popup");
    expect(run.control.effective()).toBe("popup");
    // Learning still recorded what it saw, in its own record only.
    expect(await run.stored()).toEqual(UNSUPPORTED);
    run.render();
    await run.sidePanelTalks();
    expect(run.control.preference()).toBe("popup");
    expect(run.control.effective()).toBe("popup");
  });
});

describe("self-healing", () => {
  test("a side panel render after a wrong 'unsupported' serves the side panel again", async () => {
    const run = surfaceHarness();
    await run.load();
    await run.click();
    expect(run.control.effective()).toBe("popup");
    run.render();
    await run.sidePanelTalks();
    expect(run.learner.state()).toBe("verified");
    expect(run.control.effective()).toBe("side-panel");
    expect(run.toolbar()).toEqual({ native: true, popup: "" });
    expect(await run.learner.notice()).toBe(false);
    expect(await run.stored()).toEqual(VERIFIED);
  });

  test("a panel already open at a restart corrects it too", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, UNSUPPORTED);
    const run = surfaceHarness({ store });
    run.render();
    await run.load();
    expect(run.control.effective()).toBe("side-panel");
    expect(await store.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual(VERIFIED);
  });

  test("a render during the learning window wins over the late result", async () => {
    const run = surfaceHarness();
    await run.load();
    run.onWatch(() => {
      run.learner.observeSender({
        id: "bramble",
        url: "chrome-extension://bramble/sidepanel.html",
      });
    });
    await run.click();
    expect(run.learner.state()).toBe("verified");
    expect(await run.stored()).toEqual(VERIFIED);
    expect(run.calls.popups).toEqual([]);
  });
});

describe("record changes in order", () => {
  test("a learning result queued behind a render still being stored doesn't overwrite it", async () => {
    const base = createMemoryStore();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The render's "verified" write is held, so the window still sees
    // "unknown" and ends "absent", queuing its result behind the render.
    const store = {
      ...base,
      set: async (key: string, value: unknown) => {
        if ((value as { state?: string }).state === "verified") await held;
        return base.set(key, value as never);
      },
    };
    const run = surfaceHarness({ store });
    await run.load();
    run.onWatch(() => {
      run.learner.observeSender({
        id: "bramble",
        url: "chrome-extension://bramble/sidepanel.html",
      });
    });
    await run.click();
    release();
    await settleAll();
    expect(run.learner.state()).toBe("verified");
    expect(await base.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual(VERIFIED);
    expect(run.calls.popups).toEqual([]);
  });
});

describe("choosing the side panel again where it was learned unsupported", () => {
  test("reads as 'try again': one fresh click, never a loop", async () => {
    const run = surfaceHarness();
    await run.load();
    await run.click();
    expect(run.learner.state()).toBe("unsupported");
    run.userChooses("side-panel");
    await settleAll();
    expect(run.learner.state()).toBe("unknown");
    expect(run.control.effective()).toBe("side-panel");
    expect(run.toolbar()).toEqual({ native: false, popup: "" });
    // The fresh click learns once more, and the popup serves it again.
    await run.click();
    expect(run.learner.state()).toBe("unsupported");
    const queries = run.calls.queries;
    // Without another explicit choice, later clicks don't learn again.
    await run.click();
    expect(run.calls.queries).toBe(queries);
  });

  test("choosing the popup, or the side panel on a verified browser, changes no record", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, VERIFIED);
    const run = surfaceHarness({ store });
    await run.load();
    run.userChooses("popup");
    run.userChooses("side-panel");
    await settleAll();
    expect(await store.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual(VERIFIED);
    expect(run.learner.state()).toBe("verified");
  });

  test("choosing the popup where the side panel was learned unsupported keeps the record", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, UNSUPPORTED);
    const run = surfaceHarness({ store });
    await run.load();
    run.userChooses("popup");
    await settleAll();
    expect(await store.get(SIDE_PANEL_LEARNING_STORE_KEY)).toEqual(UNSUPPORTED);
    expect(run.control.effective()).toBe("popup");
  });
});

describe("an unwritable record", () => {
  test("falls back to today's behavior and stops learning", async () => {
    const run = surfaceHarness({ writeFails: () => true });
    await run.load();
    await run.click();
    expect(run.control.effective()).toBe("side-panel");
    expect(run.toolbar()).toEqual({ native: true, popup: "" });
    expect(run.calls.popups).toEqual([]);
    expect(await run.stored()).toBeUndefined();
    const queries = run.calls.queries;
    await run.click();
    expect(run.calls.queries).toBe(queries);
  });

  test("a retry that can't be stored keeps the side panel the user chose", async () => {
    const store = createMemoryStore();
    await store.set(SIDE_PANEL_LEARNING_STORE_KEY, UNSUPPORTED);
    const run = surfaceHarness({ store, writeFails: () => true });
    await run.load();
    run.userChooses("side-panel");
    await settleAll();
    expect(run.control.effective()).toBe("side-panel");
    expect(run.toolbar()).toEqual({ native: true, popup: "" });
  });

  test("a toolbar the browser refuses to configure is repaired on the next click", async () => {
    let refusals = 0;
    const run = surfaceHarness({ configureFails: () => refusals-- > 0 });
    await run.load();
    refusals = 1;
    await run.click();
    // Learned, but the popup couldn't be applied: the next click reapplies it.
    expect(run.learner.state()).toBe("unsupported");
    await run.click();
    expect(run.toolbar().popup).toBe("popup.html");
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
  });
});
