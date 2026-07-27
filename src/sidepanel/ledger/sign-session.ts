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
import type { LedgerSignRequestSummary } from "../../popup/responses";
import { sameFelt } from "../../starknet/networks";
import {
  assertLedgerAppReady,
  type LedgerDeviceClient,
  ledgerPublicKeyX,
  ledgerSignHashOnDevice,
} from "./client";
import {
  asLedgerRejection,
  LedgerRejection,
  type LedgerRejectionCode,
  ledgerMessage,
} from "./errors";
import type { LedgerSignOutcome } from "./runtime-client";

/**
 * An OWNED device session: the {@link LedgerDeviceClient} plus the `close` that
 * releases the underlying browser transport. The transport is a serial pipe held
 * open until `close` runs, so a session MUST be closed on every outcome
 * (success, failure, retry, cancel) or the device stays claimed and later
 * attempts — here or in other Ledger clients — block. Use
 * {@link closeLedgerSessionQuietly} to close fail-closed in a `finally`.
 */
export type LedgerDeviceSession = {
  readonly client: LedgerDeviceClient;
  readonly close: () => Promise<void>;
};

/**
 * Public, non-secret descriptor for one connected, origin-granted Ledger.
 * `id` is an opaque side-panel-local handle; `label` is only for choosing among
 * simultaneously connected devices and carries no account or key material.
 */
export type LedgerDeviceChoice = {
  readonly id: string;
  readonly label: string;
};

/**
 * A source of a live device session. `listConnected`, when provided, supplies
 * non-secret choices before any device opens. `openConnected` attempts a SILENT
 * reconnect of an already-granted device (optionally the exact opaque id the
 * user selected), resolving `null` when none is connected so the caller falls
 * back to a gesture. `request` runs the gesture-gated grant flow and MUST be
 * called from a user click. All methods may reject with a
 * {@link LedgerRejection}. Every resolved session OWNS a transport the caller
 * must close (see {@link LedgerDeviceSession}).
 */
export type LedgerConnector = {
  readonly listConnected?: () => Promise<readonly LedgerDeviceChoice[]>;
  readonly openConnected: (deviceId?: string) => Promise<LedgerDeviceSession | null>;
  readonly request: () => Promise<LedgerDeviceSession>;
};

/**
 * Closes a device session best-effort, swallowing any close error. Called in a
 * `finally` on every outcome so the browser transport is always released; a close
 * failure must NEVER mask the sign result or the original device error (fail
 * closed), so it is intentionally not propagated.
 */
export const closeLedgerSessionQuietly = async (session: LedgerDeviceSession): Promise<void> => {
  await session.close().catch(() => undefined);
};

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
  readonly present: (request: LedgerSignRequestSummary) => void;
  readonly retry: () => void;
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
 * rejection.
 */
export const createLedgerSignController = (
  deps: LedgerSignControllerDeps,
): LedgerSignController => {
  let current: LedgerSignRequestSummary | null = null;
  let devices: readonly LedgerDeviceChoice[] = [];
  let busy = false;
  let operationEpoch = 0;

  const show = (phase: LedgerSignPhase): void => {
    if (current) {
      deps.render({ phase, request: current });
    }
  };

  const signWith = async (client: LedgerDeviceClient, epoch: number): Promise<void> => {
    const request = current;
    if (!request) {
      return;
    }
    const isActive = (): boolean => current?.id === request.id && operationEpoch === epoch;
    show({ kind: "checking" });
    // Shared pre-check before the on-device confirm: assert the Starknet app is
    // at/above the pinned floor (a locked/disconnected device surfaces here as a
    // thrown transport error on the version read), then confirm the device holds
    // the account's key at `path` — a mismatch is the wrong Ledger and gets that
    // actionable copy instead of a post-sign verify failure. Fund safety still
    // rests on the background verify gate; this only fails faster and clearer.
    await assertLedgerAppReady(client);
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
        await signWith(session.client, epoch);
      } else {
        show({ kind: "connect" });
      }
    } catch (error) {
      show(errorPhase(asLedgerRejection(error).code));
    } finally {
      if (session) {
        await closeLedgerSessionQuietly(session);
      }
      busy = false;
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
      busy = false;
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
  };
};
