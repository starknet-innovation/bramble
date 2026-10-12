/**
 * Side-panel consumer that fulfils a background Ledger sign request end to end.
 *
 * The service worker cannot hold a browser device, so it parks each keyless-Ledger
 * signature as a pending request and waits for the panel — the one context that
 * owns the transport — to blind-sign it on the device and hand back the raw
 * `(r, s)`. This controller is that consumer: given one pending request it
 * resolves a live device client (explicit choice when several granted devices
 * are connected, otherwise silent reconnect or a gesture-gated connect), drives
 * `signHash(path, hash)` on the device, and reports the outcome to the background
 * queue.
 *
 * Fail-closed and abortive by construction: nothing is submitted until the panel
 * reports a signature (`settle`), and it only ever reports the raw device
 * `(r, s)` — the mandatory verify-against-`publicKeyX` gate runs in the
 * background before broadcast, so this module never re-implements it. Every
 * device/transport failure is mapped to the typed {@link LedgerRejection}
 * catalog and surfaced as an actionable error state; the pending request stays
 * parked (nothing submitted) until the user retries or cancels, and a cancel
 * reports a clean rejection so the dapp/transfer promise settles rather than
 * hanging. Device I/O is injected through {@link LedgerConnector}, so the whole
 * decision flow is exercised without hardware.
 */

import {
  assertLedgerDeviceReady,
  ledgerPublicKeyX,
  ledgerSignHashOnDevice,
} from "@bramble/ledger-protocol/client";
import {
  asLedgerRejection,
  LedgerRejection,
  type LedgerRejectionCode,
  ledgerMessage,
} from "@bramble/ledger-protocol/errors";
import {
  closeLedgerSessionQuietly,
  type LedgerConnector,
  type LedgerDeviceChoice,
  type LedgerDeviceSession,
} from "@bramble/ledger-protocol/session";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { LedgerSignRequestSummary } from "../../../popup/responses/responses";
import type { LedgerSignOutcome } from "./runtime-client";

/**
 * Browser-owned Ledger capabilities consumed by this presentation controller.
 */
export type { LedgerConnector, LedgerDeviceChoice, LedgerDeviceSession };

/**
 * The device-prompt phase the panel renders for the active request. Discovery,
 * transport connection, app checks, account-key verification, device approval,
 * and signature handoff are distinct so the user always sees the real work
 * currently happening. `connect` needs a user gesture; `error` carries a
 * catalog code and actionable recovery copy.
 */
export type LedgerSignPhase =
  | { readonly kind: "checking" }
  | { readonly kind: "connect" }
  | { readonly kind: "connecting" }
  | { readonly kind: "confirming" }
  | { readonly kind: "discovering" }
  | { readonly kind: "devices"; readonly devices: readonly LedgerDeviceChoice[] }
  | { readonly kind: "error"; readonly code: LedgerRejectionCode; readonly message: string }
  | { readonly kind: "submitting" }
  | { readonly kind: "verifying" };

/**
 * The full device-prompt view: the phase plus the request it is for. `null`
 * (passed to the renderer) means no prompt is showing.
 */
export type LedgerSignView = {
  readonly phase: LedgerSignPhase;
  readonly request: LedgerSignRequestSummary;
};

/**
 * Collaborators the controller drives, all injected so the flow runs without
 * hardware: the device {@link LedgerConnector}, the queue `report` callback
 * (the panel→background `completeLedgerSign` round-trip), and a `render` sink
 * called with the current view or `null` when the prompt dismisses.
 */
export type LedgerSignControllerDeps = {
  readonly connector: LedgerConnector;
  readonly render: (view: LedgerSignView | null) => void;
  readonly report: (outcome: LedgerSignOutcome) => Promise<void>;
};

/**
 * Drives a single active Ledger sign request to a terminal outcome. Returned by
 * {@link createLedgerSignController}.
 */
export type LedgerSignController = {
  readonly activeId: () => string | null;
  readonly cancel: () => Promise<void>;
  readonly chooseDevice: (deviceId: string) => void;
  readonly connect: () => void;
  readonly dismiss: () => void;
  readonly present: (request: LedgerSignRequestSummary) => void;
  readonly retry: () => void;
  readonly whenIdle: () => Promise<void>;
};

const errorPhase = (code: LedgerRejectionCode): LedgerSignPhase => ({
  code,
  kind: "error",
  message: ledgerMessage(code),
});

/**
 * Creates a controller for the side-panel Ledger signing runtime. Single-flight
 * by design: it fulfils one request at a time (the transport is a serial pipe) and
 * ignores a second `present` while one is active. `present` discovers granted
 * devices, asks for an explicit choice when necessary, and otherwise starts a
 * silent reconnect. `connect` runs the gesture-gated grant flow for the connect
 * state; `retry` repeats discovery after a recoverable error (unlock, enable
 * blind signing) against the SAME parked request; `cancel` reports a clean
 * rejection; `dismiss` drops a request the background no longer holds (a lock
 * or the queue's timeout settled it) without reporting anything. `present`
 * ignores a request while an earlier device operation is still winding down;
 * `whenIdle` resolves once it has, so the caller can offer the request again.
 */
export const createLedgerSignController = (
  deps: LedgerSignControllerDeps,
): LedgerSignController => {
  let current: LedgerSignRequestSummary | null = null;
  let devices: readonly LedgerDeviceChoice[] = [];
  let busy = false;
  let operationEpoch = 0;
  let idleWaiters: Array<() => void> = [];

  const settle = (): void => {
    busy = false;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  };

  const show = (phase: LedgerSignPhase): void => {
    if (current) {
      deps.render({ phase, request: current });
    }
  };

  const signWith = async (session: LedgerDeviceSession, epoch: number): Promise<void> => {
    const request = current;
    if (!request) {
      return;
    }
    const { client } = session;
    const isActive = (): boolean => current?.id === request.id && operationEpoch === epoch;
    show({ kind: "checking" });
    // Shared pre-check before the on-device confirm: unless the grant broker
    // already checked this exact live session, assert the device OS and Starknet
    // app are at/above the pinned floors. Then confirm the device holds
    // the account's key at `path` — a mismatch is the wrong Ledger and gets that
    // actionable copy instead of a post-sign verify failure. Fund safety still
    // rests on the background verify gate; this only fails faster and clearer.
    if (session.readiness !== "verified") {
      await assertLedgerDeviceReady(client);
    }
    if (!isActive()) {
      return;
    }
    show({ kind: "verifying" });
    const devicePublicKeyX = await ledgerPublicKeyX(client, request.path);
    if (!isActive()) {
      return;
    }
    if (!sameFelt(devicePublicKeyX, request.publicKeyX)) {
      throw new LedgerRejection("wrong-device");
    }
    show({ kind: "confirming" });
    const signature = await ledgerSignHashOnDevice(client, request.path, request.messageHash);
    if (!isActive()) {
      return;
    }
    show({ kind: "submitting" });
    await deps.report({ id: request.id, r: signature.r, s: signature.s });
    current = null;
    devices = [];
    operationEpoch += 1;
    deps.render(null);
  };

  // Resolves a session through `obtain`, then blind-signs. A `null` session (no
  // granted device) parks the connect state for a gesture; any thrown
  // device/transport failure becomes a typed error state, leaving the request
  // parked so a retry or cancel can still resolve it (nothing submitted). The
  // session owns the browser transport, so it is closed in the `finally` on every
  // outcome (signed, failed, connect-parked) — the device is never left claimed.
  const drive = async (obtain: () => Promise<LedgerDeviceSession | null>): Promise<void> => {
    if (!current || busy) {
      return;
    }
    busy = true;
    const epoch = operationEpoch;
    let session: LedgerDeviceSession | null = null;
    try {
      session = await obtain();
      if (session) {
        await signWith(session, epoch);
      } else {
        show({ kind: "connect" });
      }
    } catch (error) {
      show(errorPhase(asLedgerRejection(error).code));
    } finally {
      if (session) {
        await closeLedgerSessionQuietly(session);
      }
      settle();
    }
  };

  const discover = async (): Promise<void> => {
    const list = deps.connector.listConnected;
    if (!list) {
      await drive(() => deps.connector.openConnected());
      return;
    }
    if (!current || busy) {
      return;
    }
    show({ kind: "discovering" });
    busy = true;
    try {
      devices = await list();
      if (devices.length > 1) {
        show({ devices, kind: "devices" });
        return;
      }
    } catch (error) {
      show(errorPhase(asLedgerRejection(error).code));
      return;
    } finally {
      settle();
    }
    await drive(() => deps.connector.openConnected(devices[0]?.id));
  };

  return {
    activeId: () => current?.id ?? null,
    async cancel() {
      const request = current;
      if (!request) {
        return;
      }
      current = null;
      devices = [];
      operationEpoch += 1;
      deps.render(null);
      await deps.report({ error: "rejected-on-device", id: request.id });
    },
    chooseDevice(deviceId) {
      if (!devices.some((device) => device.id === deviceId)) {
        return;
      }
      show({ kind: "connecting" });
      void drive(() => deps.connector.openConnected(deviceId));
    },
    connect() {
      if (!current || busy) {
        return;
      }
      show({ kind: "connecting" });
      void drive(deps.connector.request);
    },
    dismiss() {
      if (!current) {
        return;
      }
      // The epoch bump stops an in-flight device operation from reporting or
      // repainting; its session is still closed by `drive`'s finally.
      current = null;
      devices = [];
      operationEpoch += 1;
      deps.render(null);
    },
    present(request) {
      if (current || busy) {
        return;
      }
      current = request;
      operationEpoch += 1;
      void discover();
    },
    retry() {
      void discover();
    },
    whenIdle: () =>
      busy ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve(),
  };
};
