/**
 * Lifetime of the Ledger device-sign takeover (Sherlock 227, 228, 259).
 *
 * The overlay survives dashboard repaints, so nothing else takes it down: it
 * must follow the background queue, leaving when a lock or the queue's timeout
 * settles the parked request and switching when another request replaces it.
 * It must never start a device flow from the toolbar popup, which closes when
 * the grant tab takes focus and orphans the device claim. And it must stack
 * above the Ledger onboarding takeover, so the hash to compare is on top.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import type {
  LedgerSignRequestSummary,
  WalletStatus,
} from "../../../../src/popup/responses/responses";
import type { LedgerSignOutcome } from "../../../../src/sidepanel/journeys/ledger/runtime-client";
import { createLedgerSignRuntime } from "../../../../src/sidepanel/journeys/ledger/sign-runtime";
import type { LedgerConnector } from "../../../../src/sidepanel/journeys/ledger/sign-session";
import {
  LEDGER_OVERLAY_LAYERS,
  STRUCTURE_STYLES,
} from "../../../../src/sidepanel/styles/core/styles-structure";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const request = (id: string, messageHash: string): LedgerSignRequestSummary => ({
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  id,
  messageHash,
  path: ledgerAccountPath(0),
  publicKeyX: "0xabc",
});

const FIRST = request("ledger-sign-1", "0x1111aaaa");
const SECOND = request("ledger-sign-2", "0x2222bbbb");

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// No device is granted, so a presented request parks on the connect state and
// stays on screen until something takes it down.
const idleConnector: LedgerConnector = {
  openConnected: () => Promise.resolve(null),
  request: () => Promise.reject(new Error("no gesture in these tests")),
};

const mountRuntime = (
  surface: "popup" | "side-panel",
  connector: LedgerConnector = idleConnector,
) => {
  document.body.replaceChildren();
  document.body.className = surface === "popup" ? "popup-surface" : "";
  const mount = document.createElement("div");
  mount.hidden = true;
  document.body.append(mount);
  let pending: readonly LedgerSignRequestSummary[] = [];
  let loads = 0;
  const reports: LedgerSignOutcome[] = [];
  const runtime = createLedgerSignRuntime({
    connector,
    mount,
    status: () => status,
    wallet: {
      completeLedgerSign: (outcome) => {
        reports.push(outcome);
        return Promise.resolve();
      },
      loadLedgerSignPending: () => {
        loads += 1;
        return Promise.resolve(pending);
      },
    },
  });
  return {
    loads: () => loads,
    mount,
    reports,
    runtime,
    setPending: (next: readonly LedgerSignRequestSummary[]) => {
      pending = next;
    },
  };
};

describe("the device-sign takeover follows the parked queue", () => {
  test("leaves when the queue empties, as after a lock or the queue's timeout", async () => {
    const host = mountRuntime("side-panel");
    host.setPending([FIRST]);
    await host.runtime.poll();
    await tick();
    expect(host.mount.hidden).toBe(false);
    expect(host.mount.textContent).toContain("1111aaaa");

    host.setPending([]);
    await host.runtime.poll();
    await tick();

    expect(host.mount.hidden).toBe(true);
    expect(host.mount.textContent).toBe("");
    expect(host.reports).toEqual([]);
  });

  test("switches to the request that replaced the presented one", async () => {
    const host = mountRuntime("side-panel");
    host.setPending([FIRST]);
    await host.runtime.poll();
    await tick();

    host.setPending([SECOND]);
    await host.runtime.poll();
    await tick();

    expect(host.mount.hidden).toBe(false);
    expect(host.mount.textContent).toContain("2222bbbb");
    expect(host.mount.textContent).not.toContain("1111aaaa");
  });

  test("keeps the presented request while it is still parked", async () => {
    const host = mountRuntime("side-panel");
    host.setPending([FIRST, SECOND]);
    await host.runtime.poll();
    await tick();
    host.setPending([SECOND, FIRST]);
    await host.runtime.poll();
    await tick();
    expect(host.mount.textContent).toContain("1111aaaa");
  });

  test("dismiss takes it down without a round-trip or a report", async () => {
    const host = mountRuntime("side-panel");
    host.setPending([FIRST]);
    await host.runtime.poll();
    await tick();
    const loads = host.loads();

    host.runtime.dismiss();

    expect(host.mount.hidden).toBe(true);
    expect(host.loads()).toBe(loads);
    expect(host.reports).toEqual([]);
  });

  test("a device operation still running when the request goes is never reported", async () => {
    let finishSign: (() => void) | null = null;
    const client: LedgerDeviceClient = {
      getAppVersion: () =>
        Promise.resolve({
          errorMessage: "No errors",
          major: 2,
          minor: 4,
          patch: 0,
          returnCode: 0x9000,
        }),
      getOsVersion: () => Promise.resolve({ targetId: 0x33000004, version: "2.7.1" }),
      getPubKey: () =>
        Promise.resolve({
          errorMessage: "No errors",
          publicKey: Uint8Array.from([...Array(30).fill(0), 0x0a, 0xbc, ...Array(32).fill(0xff)]),
          returnCode: 0x9000,
        }),
      signHash: () =>
        new Promise((resolve) => {
          finishSign = () =>
            resolve({
              errorMessage: "No errors",
              r: new Uint8Array([...Array(31).fill(0), 1]),
              returnCode: 0x9000,
              s: new Uint8Array([...Array(31).fill(0), 2]),
              v: 1,
            });
        }),
    };
    let closed = 0;
    const host = mountRuntime("side-panel", {
      openConnected: () =>
        Promise.resolve({
          client,
          close: () => {
            closed += 1;
            return Promise.resolve();
          },
        }),
      request: () => Promise.reject(new Error("unused")),
    });
    host.setPending([FIRST]);
    await host.runtime.poll();
    for (let step = 0; step < 10 && finishSign === null; step += 1) {
      await tick();
    }
    expect(finishSign).not.toBeNull();

    host.runtime.dismiss();
    (finishSign as unknown as () => void)();
    for (let step = 0; step < 5; step += 1) {
      await tick();
    }

    expect(host.reports).toEqual([]);
    expect(host.mount.hidden).toBe(true);
    expect(closed).toBe(1);
  });
});

describe("a request that arrives while a dismissed operation winds down", () => {
  test("is presented once that operation has finished", async () => {
    let releaseClose: (() => void) | null = null;
    const client: LedgerDeviceClient = {
      getAppVersion: () =>
        Promise.resolve({
          errorMessage: "No errors",
          major: 2,
          minor: 4,
          patch: 0,
          returnCode: 0x9000,
        }),
      getOsVersion: () => Promise.resolve({ targetId: 0x33000004, version: "2.7.1" }),
      // A key that does not match, so the operation fails fast and then waits
      // on its transport close, which the test holds open.
      getPubKey: () =>
        Promise.resolve({
          errorMessage: "No errors",
          publicKey: new Uint8Array(64).fill(0x01),
          returnCode: 0x9000,
        }),
      signHash: () => Promise.reject(new Error("unused")),
    };
    let opens = 0;
    const host = mountRuntime("side-panel", {
      openConnected: () => {
        opens += 1;
        return Promise.resolve({
          client,
          close: () =>
            opens === 1
              ? new Promise<void>((resolve) => {
                  releaseClose = resolve;
                })
              : Promise.resolve(),
        });
      },
      request: () => Promise.reject(new Error("unused")),
    });
    host.setPending([FIRST]);
    await host.runtime.poll();
    for (let step = 0; step < 10 && releaseClose === null; step += 1) {
      await tick();
    }
    expect(releaseClose).not.toBeNull();

    // The first request settles in the background and a second one parks
    // while the first operation is still closing its transport.
    host.setPending([SECOND]);
    await host.runtime.poll();
    await tick();
    expect(host.mount.textContent).not.toContain("1111aaaa");

    (releaseClose as unknown as () => void)();
    for (let step = 0; step < 10; step += 1) {
      await tick();
    }

    expect(host.mount.hidden).toBe(false);
    expect(host.mount.textContent).toContain("2222bbbb");
  });
});

describe("the toolbar popup never starts a device sign", () => {
  test("a parked request is left for the side panel", async () => {
    const host = mountRuntime("popup", {
      openConnected: () => {
        throw new Error("the device must not be reached from the popup surface");
      },
      request: () => {
        throw new Error("the device must not be reached from the popup surface");
      },
    });
    host.setPending([FIRST]);

    await host.runtime.poll();
    await tick();

    expect(host.loads()).toBe(0);
    expect(host.mount.hidden).toBe(true);
    expect(host.reports).toEqual([]);
  });
});

describe("stacking of the two Ledger takeovers", () => {
  test("the device-sign prompt sits above the onboarding overlay", () => {
    expect(LEDGER_OVERLAY_LAYERS.sign).toBeGreaterThan(LEDGER_OVERLAY_LAYERS.onboard);
    const rule = (selector: string): string =>
      STRUCTURE_STYLES.slice(STRUCTURE_STYLES.indexOf(`${selector} {`)).split("}")[0] ?? "";
    expect(rule(".ledger-sign-overlay")).toContain(`z-index: ${LEDGER_OVERLAY_LAYERS.sign};`);
    expect(rule(".ledger-onboard-overlay")).toContain(`z-index: ${LEDGER_OVERLAY_LAYERS.onboard};`);
  });
});
