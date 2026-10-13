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
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import type { LedgerSignRequestSummary } from "../../../../src/popup/responses/responses";
import type { LedgerSignOutcome } from "../../../../src/sidepanel/journeys/ledger/runtime-client";
import {
  createLedgerSignController,
  type LedgerConnector,
  type LedgerDeviceSession,
  type LedgerSignView,
} from "../../../../src/sidepanel/journeys/ledger/sign-session";

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
  Promise.resolve({ errorMessage: "No errors", major: 2, minor: 4, patch: 0, returnCode: 0x9000 });

const okOsVersion = () => Promise.resolve({ targetId: 0x33000004, version: "2.7.1" });

const okPubKey = (): ReturnType<LedgerDeviceClient["getPubKey"]> =>
  Promise.resolve({ errorMessage: "No errors", publicKey: DEVICE_PUBLIC_KEY, returnCode: 0x9000 });

// The shared pre-check defaults to a ready device; overrides drive its failure paths.
const fakeClient = (
  signHash: LedgerDeviceClient["signHash"],
  overrides: Partial<LedgerDeviceClient> = {},
): LedgerDeviceClient => ({
  getOsVersion: okOsVersion,
  getAppVersion: okVersion,
  getPubKey: okPubKey,
  signHash,
  ...overrides,
});

const okSign = (): ReturnType<LedgerDeviceClient["signHash"]> =>
  Promise.resolve({
    errorMessage: "No errors",
    r: new Uint8Array([...Array(31).fill(0), 1]),
    returnCode: 0x9000,
    s: new Uint8Array([...Array(31).fill(0), 2]),
  });

// A connector expressed in terms of the device CLIENT (no transport). The
// harness wraps each resolved client in an OWNED session whose `close` bumps a
// counter, so tests assert the transport is released on every outcome without a
// real WebHID handle.
type ClientConnector = {
  readonly listConnected?: LedgerConnector["listConnected"];
  readonly openConnected: (deviceId?: string) => Promise<LedgerDeviceClient | null>;
  readonly request: () => Promise<LedgerDeviceClient>;
};

type Harness = {
  readonly closed: () => number;
  readonly connector: LedgerConnector;
  readonly reports: LedgerSignOutcome[];
  readonly views: (LedgerSignView | null)[];
};

const harness = (source: ClientConnector): Harness => {
  const reports: LedgerSignOutcome[] = [];
  const views: (LedgerSignView | null)[] = [];
  let closed = 0;
  const wrap = (client: LedgerDeviceClient): LedgerDeviceSession => ({
    client,
    close: () => {
      closed += 1;
      return Promise.resolve();
    },
  });
  const connector: LedgerConnector = {
    ...(source.listConnected ? { listConnected: source.listConnected } : {}),
    openConnected: (deviceId) =>
      source.openConnected(deviceId).then((client) => (client ? wrap(client) : null)),
    request: () => source.request().then(wrap),
  };
  return { closed: () => closed, connector, reports, views };
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

    expect(phases(h.views)).toEqual(["checking", "verifying", "confirming", "submitting", null]);
    // The raw device (r, s) was reported to the background queue for this id.
    expect(h.reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
    // The owned transport is released on the success path.
    expect(h.closed()).toBe(1);
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
    expect(phases(h.views)).toEqual([
      "connect",
      "connecting",
      "checking",
      "verifying",
      "confirming",
      "submitting",
      null,
    ]);
    expect(h.reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
  });

  test("lists multiple devices and opens only the one the user selects", async () => {
    let openedId: string | undefined;
    const h = harness({
      listConnected: () =>
        Promise.resolve([
          { id: "first", label: "Ledger Nano X 1" },
          { id: "second", label: "Ledger Nano X 2" },
        ]),
      openConnected: (deviceId) => {
        openedId = deviceId;
        return Promise.resolve(fakeClient(okSign));
      },
      request: () => Promise.reject(new Error("no picker expected")),
    });
    const controller = controllerFor(h);
    controller.present(REQUEST);
    await tick();

    expect(h.views.at(-1)?.phase.kind).toBe("devices");
    expect(openedId).toBeUndefined();
    expect(h.reports).toEqual([]);

    controller.chooseDevice("second");
    await tick();
    expect(openedId).toBe("second");
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

  test("closes the device session when the sign fails", async () => {
    // A locked device throws on the pre-check version read after the session is
    // obtained, so the drive lands in the error branch — and must still close.
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

    expect(h.views.at(-1)?.phase.kind).toBe("error");
    expect(h.reports).toEqual([]);
    // The transport is released even though the sign failed (fail closed).
    expect(h.closed()).toBe(1);
  });

  test("closes the device session even when the user cancels an in-flight connect", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({
      openConnected: () => gate.then(() => fakeClient(okSign)),
      request: () => Promise.reject(new Error("unused")),
    });
    const controller = controllerFor(h);
    controller.present(REQUEST); // starts the drive; openConnected awaits the gate
    await controller.cancel(); // user dismisses while the open is in flight
    release(); // the session now resolves; the in-flight drive continues
    await tick();
    await tick();

    // The drive's finally still ran: nothing was signed (current was cleared by
    // cancel), a clean rejection was reported, and the transport was released.
    expect(h.reports).toEqual([{ error: "rejected-on-device", id: "ledger-sign-1" }]);
    expect(h.closed()).toBe(1);
  });

  test("cancel discards a signature that resolves after cancellation", async () => {
    let resolveSignature: (value: Awaited<ReturnType<LedgerDeviceClient["signHash"]>>) => void =
      () => undefined;
    const signature = new Promise<Awaited<ReturnType<LedgerDeviceClient["signHash"]>>>(
      (resolve) => {
        resolveSignature = resolve;
      },
    );
    const h = harness({
      openConnected: () => Promise.resolve(fakeClient(() => signature)),
      request: () => Promise.reject(new Error("unused")),
    });
    const controller = controllerFor(h);
    controller.present(REQUEST);
    await tick();
    await controller.cancel();
    resolveSignature({
      errorMessage: "No errors",
      r: new Uint8Array([...Array(31).fill(0), 1]),
      returnCode: 0x9000,
      s: new Uint8Array([...Array(31).fill(0), 2]),
    });
    await tick();

    expect(h.reports).toEqual([{ error: "rejected-on-device", id: "ledger-sign-1" }]);
    expect(h.closed()).toBe(1);
  });

  test("a close failure is swallowed and does not mask the sign result", async () => {
    // The session's close rejects, but the sign already succeeded: the failure
    // must be swallowed (fail closed) so the reported (r, s) and dismissal stand.
    const reports: LedgerSignOutcome[] = [];
    const views: (LedgerSignView | null)[] = [];
    const connector: LedgerConnector = {
      openConnected: () =>
        Promise.resolve({
          client: fakeClient(okSign),
          close: () => Promise.reject(new Error("close failed")),
        }),
      request: () => Promise.reject(new Error("unused")),
    };
    const controller = createLedgerSignController({
      connector,
      render: (view) => views.push(view),
      report: (outcome) => {
        reports.push(outcome);
        return Promise.resolve();
      },
    });
    controller.present(REQUEST);
    await tick();

    expect(reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
    expect(views.at(-1)).toBeNull();
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

// Errors audit F9: the device signed and the wallet's half failed. That is not
// a device fault, and the transaction may be on its way.
describe("a wallet failure after the device signed", () => {
  test("reads as signing that didn't finish, never as a Ledger fault", async () => {
    const h = harness({
      openConnected: () => Promise.resolve(fakeClient(okSign)),
      request: () => Promise.reject(new Error("unused")),
    });
    const controller = createLedgerSignController({
      connector: h.connector,
      render: (view) => h.views.push(view),
      report: () => Promise.reject(new Error("vault storage limit reached")),
    });
    controller.present(REQUEST);
    await tick();

    const last = h.views.at(-1);
    expect(last?.phase).toEqual({
      code: null,
      kind: "error",
      message: "Signing on your Ledger didn't finish. Check Activity before trying again.",
    });
    expect(last?.phase.kind === "error" && last.phase.message).not.toContain(
      "talking to your Ledger",
    );
    // The transport is still released.
    expect(h.closed()).toBe(1);
  });
});
