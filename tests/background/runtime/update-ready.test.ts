/**
 * A downloaded update is applied as soon as nothing is in use, never while an
 * approval, signature, privacy job or request is in progress, and the panel's
 * restart obeys the same rule (mc-wallet #708). Once the background listens
 * for `onUpdateAvailable` the browser stops reloading it by itself, so these
 * pin that the wallet always finishes the job.
 */

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createUpdateReady,
  handleUpdateOps,
  inertUpdateReady,
  UPDATE_BUSY,
  type UpdateRuntime,
} from "../../../apps/extension/src/background/runtime/update-ready";
import { REPO_DIR } from "../../support/workspace-sources";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const fakeRuntime = (
  options: { readonly pages?: () => number; readonly contexts?: boolean } = {},
) => {
  let fire: () => void = () => undefined;
  let listeners = 0;
  const reloads: number[] = [];
  const runtime: UpdateRuntime = {
    ...(options.contexts === false
      ? {}
      : {
          getContexts: async () => Array.from({ length: options.pages?.() ?? 0 }, () => ({})),
        }),
    onUpdateAvailable: {
      addListener: (listener) => {
        listeners += 1;
        fire = listener;
      },
    },
    reload: () => {
      reloads.push(1);
    },
  };
  return {
    fire: () => fire(),
    listeners: () => listeners,
    reloads: () => reloads.length,
    runtime,
  };
};

const immediately = (run: () => void): void => run();

describe("applying a downloaded update", () => {
  test("registers its listener as soon as it is created", () => {
    const browser = fakeRuntime();
    createUpdateReady({ isBusy: () => false, runtime: browser.runtime });
    expect(browser.listeners()).toBe(1);
  });

  test("reloads straight away when nothing is in use", async () => {
    const browser = fakeRuntime();
    createUpdateReady({ isBusy: () => false, runtime: browser.runtime });
    browser.fire();
    await flush();
    expect(browser.reloads()).toBe(1);
  });

  test("waits while something is pending, then reloads once it settles", async () => {
    const browser = fakeRuntime();
    let busy = true;
    const updates = createUpdateReady({ isBusy: () => busy, runtime: browser.runtime });
    browser.fire();
    await flush();
    expect(browser.reloads()).toBe(0);
    expect(updates.ready()).toBe(true);
    busy = false;
    updates.settle();
    await flush();
    expect(browser.reloads()).toBe(1);
  });

  test("waits while a wallet page is open, then reloads once it closes", async () => {
    let pages = 1;
    const browser = fakeRuntime({ pages: () => pages });
    const updates = createUpdateReady({ isBusy: () => false, runtime: browser.runtime });
    browser.fire();
    await flush();
    expect(browser.reloads()).toBe(0);
    pages = 0;
    updates.settle();
    await flush();
    expect(browser.reloads()).toBe(1);
  });

  test("never reloads while a request is in flight", async () => {
    const browser = fakeRuntime();
    const updates = createUpdateReady({ isBusy: () => false, runtime: browser.runtime });
    let finish: () => void = () => undefined;
    const request = updates.track(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    browser.fire();
    await flush();
    expect(browser.reloads()).toBe(0);
    finish();
    await request;
    await flush();
    expect(browser.reloads()).toBe(1);
  });

  test("without a way to see open pages (Firefox) it never reloads by itself", async () => {
    const browser = fakeRuntime({ contexts: false });
    const updates = createUpdateReady({
      defer: immediately,
      isBusy: () => false,
      runtime: browser.runtime,
    });
    browser.fire();
    updates.settle();
    await flush();
    expect(browser.reloads()).toBe(0);
    expect(updates.applyNow()).toEqual({ ok: true, restarting: true });
    expect(browser.reloads()).toBe(1);
  });
});

describe("the panel's restart", () => {
  test("restarts when an update waits and nothing is in progress", async () => {
    const browser = fakeRuntime({ pages: () => 1 });
    const updates = createUpdateReady({
      defer: immediately,
      isBusy: () => false,
      runtime: browser.runtime,
    });
    browser.fire();
    await flush();
    // The restart request itself is the one request in flight.
    await updates.track(Promise.resolve().then(() => updates.applyNow()));
    expect(browser.reloads()).toBe(1);
  });

  test("refuses mid-approval or mid-send, and reloads nothing", async () => {
    const browser = fakeRuntime({ pages: () => 1 });
    let busy = true;
    const updates = createUpdateReady({
      defer: immediately,
      isBusy: () => busy,
      runtime: browser.runtime,
    });
    browser.fire();
    expect(updates.applyNow()).toEqual({ error: UPDATE_BUSY });
    busy = false;
    let finish: () => void = () => undefined;
    const send = updates.track(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    expect(await updates.track(Promise.resolve().then(() => updates.applyNow()))).toEqual({
      error: UPDATE_BUSY,
    });
    expect(browser.reloads()).toBe(0);
    finish();
    await send;
  });

  test("reports nothing to restart before an update arrives", () => {
    const browser = fakeRuntime();
    const updates = createUpdateReady({ isBusy: () => false, runtime: browser.runtime });
    expect(updates.applyNow()).toEqual({ ok: true, restarting: false });
    expect(browser.reloads()).toBe(0);
  });
});

describe("without a browser runtime", () => {
  test("the inert applier never restarts and passes work through", async () => {
    expect(inertUpdateReady.ready()).toBe(false);
    expect(inertUpdateReady.applyNow()).toEqual({ ok: true, restarting: false });
    inertUpdateReady.settle();
    expect(await inertUpdateReady.track(Promise.resolve(7))).toBe(7);
  });

  test("a failed page lookup leaves the update waiting", async () => {
    const reloads: number[] = [];
    let fire: () => void = () => undefined;
    createUpdateReady({
      isBusy: () => false,
      runtime: {
        getContexts: async () => {
          throw new Error("unavailable");
        },
        onUpdateAvailable: { addListener: (listener) => (fire = listener) },
        reload: () => reloads.push(1),
      },
    });
    fire();
    await flush();
    expect(reloads).toEqual([]);
  });
});

describe("update messages", () => {
  test("read status and restart only for exact-shape messages", () => {
    const browser = fakeRuntime();
    const updates = createUpdateReady({ isBusy: () => true, runtime: browser.runtime });
    expect(
      handleUpdateOps(updates, "wallet.updateStatus", { type: "wallet.updateStatus" }),
    ).toEqual({ ok: true, updateReady: false });
    expect(
      handleUpdateOps(updates, "wallet.updateStatus", { extra: 1, type: "wallet.updateStatus" }),
    ).toEqual({ error: "Invalid update request" });
    expect(
      handleUpdateOps(updates, "wallet.applyUpdate", { now: true, type: "wallet.applyUpdate" }),
    ).toEqual({ error: "Invalid update request" });
    expect(handleUpdateOps(updates, "wallet.status", { type: "wallet.status" })).toBeNull();
  });
});

test("the background creates the applier at the top level, so an event page keeps its listener", async () => {
  const source = await readFile(join(REPO_DIR, "apps/extension/src/background/index.ts"), "utf8");
  expect(source).toMatch(/^const updateReady = createUpdateReady\(/m);
  expect(source).toContain("updates: updateReady,");
  expect(source).toContain("updateReady.track(runtimeReady.then(");
});
