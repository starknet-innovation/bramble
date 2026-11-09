/**
 * The "An update is ready" banner (#708) appears only when the background says
 * an update waits, appears once, restarts on request, and says what to do when
 * a request in progress holds the restart back.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createUpdateClient,
  startUpdateBanner,
  UPDATE_BUSY_NOTICE,
  UPDATE_READY_BODY,
  UPDATE_READY_TITLE,
  UPDATE_RESTART_LABEL,
} from "../../../src/sidepanel/shell/update-banner";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Outcome = "busy" | "none" | "restarting";

const start = (ready: boolean, outcome: Outcome = "restarting") => {
  const restarts: number[] = [];
  let tick: () => void = () => undefined;
  startUpdateBanner({
    doc: document,
    schedule: (run) => {
      tick = run;
    },
    wallet: {
      applyUpdate: async () => {
        restarts.push(1);
        return outcome;
      },
      updateReady: async () => ready,
    },
  });
  return { restarts: () => restarts.length, tick: () => tick() };
};

describe("update banner", () => {
  test("shows once when an update is ready, outside the app root", async () => {
    const banner = start(true);
    await flush();
    banner.tick();
    await flush();
    const shown = document.querySelectorAll("#update-banner");
    expect(shown).toHaveLength(1);
    expect(shown[0]?.textContent).toContain(UPDATE_READY_TITLE);
    expect(shown[0]?.textContent).toContain(UPDATE_READY_BODY);
    expect(document.querySelector("#update-restart")?.textContent).toBe(UPDATE_RESTART_LABEL);
  });

  test("shows nothing while no update waits", async () => {
    start(false);
    await flush();
    expect(document.querySelector("#update-banner")).toBeNull();
  });

  test("its button asks for the restart", async () => {
    const banner = start(true);
    await flush();
    document.querySelector<HTMLButtonElement>("#update-restart")?.click();
    await flush();
    expect(banner.restarts()).toBe(1);
  });

  test("a refused restart says what to do and leaves the button usable", async () => {
    start(true, "busy");
    await flush();
    const control = document.querySelector<HTMLButtonElement>("#update-restart");
    control?.click();
    await flush();
    expect(document.body.textContent).toContain(UPDATE_BUSY_NOTICE);
    expect(control?.disabled).toBe(false);
  });
});

describe("failures", () => {
  test("a restart request that fails says what to do", async () => {
    startUpdateBanner({
      doc: document,
      schedule: () => undefined,
      wallet: {
        applyUpdate: async () => {
          throw new Error("worker gone");
        },
        updateReady: async () => true,
      },
    });
    await flush();
    document.querySelector<HTMLButtonElement>("#update-restart")?.click();
    await flush();
    expect(document.body.textContent).toContain(UPDATE_BUSY_NOTICE);
  });

  test("a failed status check shows nothing", async () => {
    startUpdateBanner({
      doc: document,
      schedule: () => undefined,
      wallet: {
        applyUpdate: async () => "none",
        updateReady: async () => {
          throw new Error("worker gone");
        },
      },
    });
    await flush();
    expect(document.querySelector("#update-banner")).toBeNull();
  });
});

describe("update client", () => {
  test("reads only well-formed answers", async () => {
    const client = (answer: unknown) => createUpdateClient(async () => answer);
    expect(await client({ ok: true, updateReady: true }).updateReady()).toBe(true);
    expect(await client({ ok: true, updateReady: "yes" }).updateReady()).toBe(false);
    expect(await client({ error: "x" }).updateReady()).toBe(false);
    expect(await client({ ok: true, restarting: true }).applyUpdate()).toBe("restarting");
    expect(await client({ ok: true, restarting: false }).applyUpdate()).toBe("none");
    expect(await client({ error: "update waits" }).applyUpdate()).toBe("busy");
  });
});
