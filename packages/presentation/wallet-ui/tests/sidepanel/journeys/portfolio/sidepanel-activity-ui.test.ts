/**
 * Behavioural coverage for the activity refresh + CSV export controls
 * (`bindActivity`), driven through the real bindings under happy-dom with the
 * shared transfer-ui wallet stub. CSV export's URL + setTimeout globals are
 * stubbed so the download path runs synchronously and observably.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  activityExportToast,
  bindActivity,
  type TransferUiDeps,
} from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { flush, makeWallet, paint } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const originalSetTimeout = globalThis.setTimeout;
let originalCreateObjectUrl: typeof URL.createObjectURL;
let originalRevokeObjectUrl: typeof URL.revokeObjectURL;

beforeEach(() => {
  document.body.replaceChildren();
  originalCreateObjectUrl = URL.createObjectURL;
  originalRevokeObjectUrl = URL.revokeObjectURL;
  // Run timers synchronously so the CSV revoke resolves observably within the
  // test.
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout;
});

afterEach(() => {
  (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
});

describe("activityExportToast", () => {
  test("chooses tone by history availability", () => {
    expect(activityExportToast(false)).toEqual({ message: "Activity exported", tone: "success" });
    expect(activityExportToast(true).tone).toBe("error");
  });
});

describe("bindActivity", () => {
  let createdUrls: string[];
  let revokedUrls: string[];

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    (globalThis as { URL: typeof URL }).URL = Object.assign(URL, {
      createObjectURL: (() => {
        const url = `blob:mock-${createdUrls.length}`;
        createdUrls.push(url);
        return url;
      }) as unknown as typeof URL.createObjectURL,
      revokeObjectURL: ((url: string) => {
        revokedUrls.push(url);
      }) as unknown as typeof URL.revokeObjectURL,
    });
  });

  const mountActivity = (walletOverrides: Record<string, unknown> = {}) => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    app.id = "app";
    paint(
      app,
      '<button id="activity-refresh" type="button"></button>' +
        '<button id="activity-export" type="button"></button>',
    );
    document.body.append(app);
    const { calls, wallet } = makeWallet(walletOverrides);
    const renderCalls: WalletStatus[] = [];
    const deps: TransferUiDeps = {
      app,
      render: async (next: WalletStatus) => {
        renderCalls.push(next);
      },
      wallet: wallet as unknown as TransferUiDeps["wallet"],
    };
    bindActivity(deps);
    return { app, calls, renderCalls };
  };

  test("refresh reloads status and renders it", async () => {
    const { app, calls, renderCalls } = mountActivity();
    app.querySelector<HTMLButtonElement>("#activity-refresh")?.click();
    await flush();
    expect(calls.loadStatus).toBe(1);
    expect(renderCalls).toHaveLength(1);
  });

  test("refresh failure clears the busy state without rendering", async () => {
    const { app, renderCalls } = mountActivity({
      async loadStatus() {
        throw new Error("offline");
      },
    });
    const button = app.querySelector<HTMLButtonElement>("#activity-refresh");
    button?.click();
    await flush();
    expect(renderCalls).toHaveLength(0);
    expect(button?.hasAttribute("data-busy")).toBe(false);
  });

  test("export downloads a CSV and schedules the object-URL revoke", async () => {
    const { app } = mountActivity();
    app.querySelector<HTMLButtonElement>("#activity-export")?.click();
    await flush();
    expect(createdUrls).toHaveLength(1);
    // setTimeout runs synchronously in the test, so revoke fires immediately.
    expect(revokedUrls).toEqual(createdUrls);
  });

  test("export failure clears the busy state", async () => {
    const { app } = mountActivity({
      async loadActivity() {
        throw new Error("export blew up");
      },
    });
    const button = app.querySelector<HTMLButtonElement>("#activity-export");
    button?.click();
    await flush();
    expect(button?.hasAttribute("data-busy")).toBe(false);
    expect(createdUrls).toHaveLength(0);
  });
});
