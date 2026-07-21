/**
 * Behavioural coverage for the side-panel Ledger signing controller. Driven with
 * an INJECTED fake device client and connector (no WebHID), it asserts the happy
 * path reports the device `(r, s)` to the queue and dismisses, every device
 * rejection maps to the right catalog message and aborts cleanly (nothing
 * settled), a connect gesture is surfaced when no device is granted, retry
 * re-drives the same parked request, cancel reports a clean rejection, and the
 * single-flight guard ignores a second concurrent request.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerSignRequestSummary } from "../src/popup/responses";
import type { LedgerDeviceClient } from "../src/sidepanel/ledger/client";
import { LedgerRejection } from "../src/sidepanel/ledger/errors";
import type { LedgerSignOutcome } from "../src/sidepanel/ledger/runtime-client";
import {
  createLedgerSignController,
  type LedgerConnector,
  type LedgerSignView,
} from "../src/sidepanel/ledger/sign-session";
import { ledgerAccountPath } from "../src/starknet/ledger-path";

// A 64-byte device public key X‖Y (no SEC1 prefix, matching the real library);
// its X-coordinate canonicalizes to "0x2", the account's stored publicKeyX below.
const DEVICE_PUBLIC_KEY = Uint8Array.from([...Array(31).fill(0), 0x02, ...Array(32).fill(0xff)]);
// A different device's key (X → "0x3"): the wrong Ledger for this account.
const OTHER_PUBLIC_KEY = Uint8Array.from([...Array(31).fill(0), 0x03, ...Array(32).fill(0xff)]);

const REQUEST: LedgerSignRequestSummary = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  id: "ledger-sign-1",
  messageHash: "0xabc",
  path: ledgerAccountPath(0),
  publicKeyX: "0x2",
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const okVersion = (): ReturnType<LedgerDeviceClient["getAppVersion"]> =>
  Promise.resolve({ errorMessage: "No errors", major: 2, minor: 1, patch: 0, returnCode: 0x9000 });

const okPubKey = (): ReturnType<LedgerDeviceClient["getPubKey"]> =>
  Promise.resolve({ errorMessage: "No errors", publicKey: DEVICE_PUBLIC_KEY, returnCode: 0x9000 });

// A device client whose signHash is supplied per test; the sign path now runs a
// shared pre-check (version + public-key match) first, so getAppVersion/getPubKey
// default to a ready device holding the account's key. Overrides drive the
// pre-check failure paths (locked device, wrong device).
const fakeClient = (
  signHash: LedgerDeviceClient["signHash"],
  overrides: Partial<LedgerDeviceClient> = {},
): LedgerDeviceClient => ({
  getAppVersion: okVersion,
  getPubKey: okPubKey,
  signHash,
  ...overrides,
});

const okSign = (): ReturnType<LedgerDeviceClient["signHash"]> =>
  Promise.resolve({
    errorMessage: "No errors",
    r: new Uint8Array([1]),
    returnCode: 0x9000,
    s: new Uint8Array([2]),
  });

type Harness = {
  readonly connector: LedgerConnector;
  readonly reports: LedgerSignOutcome[];
  readonly views: (LedgerSignView | null)[];
};

const harness = (connector: LedgerConnector): Harness => {
  const reports: LedgerSignOutcome[] = [];
  const views: (LedgerSignView | null)[] = [];
  return { connector, reports, views };
};

const controllerFor = (h: Harness) =>
  createLedgerSignController({
    connector: h.connector,
    render: (view) => h.views.push(view),
    report: (outcome) => {
      h.reports.push(outcome);
      return Promise.resolve();
    },
  });

// The phase kinds the controller drove through, for a concise assertion.
const phases = (views: readonly (LedgerSignView | null)[]): readonly (string | null)[] =>
  views.map((view) => (view === null ? null : view.phase.kind));

describe("Ledger sign controller", () => {
  test("silently reconnects, blind-signs, reports (r,s), and dismisses", async () => {
    const h = harness({
      openConnected: () => Promise.resolve(fakeClient(okSign)),
      request: () => Promise.reject(new Error("no gesture expected")),
    });
    controllerFor(h).present(REQUEST);
    await tick();

    // Went straight to the on-device wait, then dismissed on success.
    expect(phases(h.views)).toEqual(["confirming", null]);
    // The raw device (r, s) was reported to the background queue for this id.
    expect(h.reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
  });

  test("surfaces the connect gesture when no device is granted, then signs", async () => {
    let granted = false;
    const client = fakeClient(okSign);
    const h = harness({
      openConnected: () => Promise.resolve(granted ? client : null),
      request: () => {
        granted = true;
        return Promise.resolve(client);
      },
    });
    const controller = controllerFor(h);
    controller.present(REQUEST);
    await tick();
    expect(phases(h.views)).toEqual(["connect"]);
    expect(h.reports).toEqual([]);

    controller.connect();
    await tick();
    expect(phases(h.views)).toEqual(["connect", "confirming", null]);
    expect(h.reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
  });

  test("a device rejection maps to its catalog message and settles nothing", async () => {
    const h = harness({
      openConnected: () =>
        Promise.resolve(
          fakeClient(() =>
            Promise.resolve({
              errorMessage: "user rejected",
              r: new Uint8Array(),
              returnCode: 0x6e04,
              s: new Uint8Array(),
            }),
          ),
        ),
      request: () => Promise.reject(new Error("unused")),
    });
    controllerFor(h).present(REQUEST);
    await tick();

    const last = h.views.at(-1);
    expect(last?.phase.kind).toBe("error");
    if (last?.phase.kind === "error") {
      expect(last.phase.code).toBe("rejected-on-device");
      expect(last.phase.message).toContain("rejected the request");
    }
    // Nothing was reported: the request stays parked, nothing submitted.
    expect(h.reports).toEqual([]);
  });

  test("a blind-signing-disabled refusal shows the one-time unblock copy", async () => {
    // The real library folds a blind-signing refusal into ExecutionError (0x6f00)
    // on signHash — never a distinct status word — so the classifier keys off it.
    const h = harness({
      openConnected: () =>
        Promise.resolve(
          fakeClient(() =>
            Promise.resolve({
              errorMessage: "Execution Error",
              r: new Uint8Array(),
              returnCode: 0x6f00,
              s: new Uint8Array(),
            }),
          ),
        ),
      request: () => Promise.reject(new Error("unused")),
    });
    controllerFor(h).present(REQUEST);
    await tick();

    const last = h.views.at(-1);
    expect(last?.phase.kind === "error" && last.phase.code).toBe("blind-signing-disabled");
  });

  test("a thrown transport error on the pre-check (device locked) maps to device-locked", async () => {
    // getAppVersion lets transport throws propagate (signHash swallows them), so
    // the shared pre-check's version read is where a locked device is detected.
    const h = harness({
      openConnected: () =>
        Promise.resolve(
          fakeClient(okSign, {
            getAppVersion: () => Promise.reject(new Error("device is locked")),
          }),
        ),
      request: () => Promise.reject(new Error("unused")),
    });
    controllerFor(h).present(REQUEST);
    await tick();

    const last = h.views.at(-1);
    expect(last?.phase.kind === "error" && last.phase.code).toBe("device-locked");
  });

  test("a device holding a different key is rejected as wrong-device, nothing signed", async () => {
    let signed = false;
    const h = harness({
      openConnected: () =>
        Promise.resolve(
          fakeClient(
            () => {
              signed = true;
              return okSign();
            },
            {
              getPubKey: () =>
                Promise.resolve({
                  errorMessage: "",
                  publicKey: OTHER_PUBLIC_KEY,
                  returnCode: 0x9000,
                }),
            },
          ),
        ),
      request: () => Promise.reject(new Error("unused")),
    });
    controllerFor(h).present(REQUEST);
    await tick();

    const last = h.views.at(-1);
    expect(last?.phase.kind === "error" && last.phase.code).toBe("wrong-device");
    // The wrong device is caught BEFORE the on-device confirm: nothing is signed
    // or reported (fund safety still also rests on the background verify gate).
    expect(signed).toBe(false);
    expect(h.reports).toEqual([]);
  });

  test("an open failure (device busy) becomes an error state, no gesture", async () => {
    const h = harness({
      openConnected: () => Promise.reject(new LedgerRejection("device-busy")),
      request: () => Promise.reject(new Error("unused")),
    });
    controllerFor(h).present(REQUEST);
    await tick();

    const last = h.views.at(-1);
    expect(last?.phase.kind === "error" && last.phase.code).toBe("device-busy");
    expect(h.reports).toEqual([]);
  });

  test("retry re-drives the same parked request after a recoverable error", async () => {
    let attempt = 0;
    const client = fakeClient(okSign, {
      getAppVersion: () =>
        attempt++ === 0 ? Promise.reject(new Error("device is locked")) : okVersion(),
    });
    const h = harness({
      openConnected: () => Promise.resolve(client),
      request: () => Promise.reject(new Error("unused")),
    });
    const controller = controllerFor(h);
    controller.present(REQUEST);
    await tick();
    expect(h.views.at(-1)?.phase.kind).toBe("error");

    controller.retry();
    await tick();
    expect(h.views.at(-1)).toBeNull();
    expect(h.reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
  });

  test("cancel reports a clean rejection and dismisses", async () => {
    const h = harness({
      openConnected: () => Promise.resolve(null),
      request: () => Promise.reject(new Error("unused")),
    });
    const controller = controllerFor(h);
    controller.present(REQUEST);
    await tick();
    expect(controller.activeId()).toBe("ledger-sign-1");

    await controller.cancel();
    expect(h.views.at(-1)).toBeNull();
    expect(h.reports).toEqual([{ error: "rejected-on-device", id: "ledger-sign-1" }]);
    expect(controller.activeId()).toBeNull();
  });

  test("cancel with no active request is a no-op", async () => {
    const h = harness({
      openConnected: () => Promise.resolve(null),
      request: () => Promise.reject(new Error("unused")),
    });
    const controller = controllerFor(h);
    await controller.cancel();
    expect(h.reports).toEqual([]);
    expect(h.views).toEqual([]);
  });

  test("single-flight: a second present while one is active is ignored", async () => {
    const h = harness({
      openConnected: () => Promise.resolve(fakeClient(okSign)),
      request: () => Promise.reject(new Error("unused")),
    });
    const controller = controllerFor(h);
    controller.present(REQUEST);
    controller.present({ ...REQUEST, id: "ledger-sign-2" });
    await tick();

    // Only the first request was fulfilled.
    expect(h.reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
  });

  test("a connect click while a reconnect is in flight is ignored (serial pipe)", async () => {
    let opens = 0;
    const h = harness({
      openConnected: () => {
        opens += 1;
        return Promise.resolve(fakeClient(okSign));
      },
      request: () => Promise.reject(new Error("must not be called")),
    });
    const controller = controllerFor(h);
    controller.present(REQUEST); // starts an in-flight openConnected (busy)
    controller.connect(); // must be dropped while busy, not run request()
    await tick();

    expect(opens).toBe(1);
    expect(h.reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
  });

  test("connect and retry are no-ops when nothing is active", async () => {
    const h = harness({
      openConnected: () => Promise.reject(new Error("must not be called")),
      request: () => Promise.reject(new Error("must not be called")),
    });
    const controller = controllerFor(h);
    controller.connect();
    controller.retry();
    await tick();
    expect(h.views).toEqual([]);
    expect(h.reports).toEqual([]);
  });
});
