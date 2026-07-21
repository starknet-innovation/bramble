/**
 * Side-panel consumer that fulfils a background Ledger sign request end to end.
 *
 * The service worker cannot hold a WebHID device, so it parks each keyless-Ledger
 * signature as a pending request and waits for the panel — the one context that
 * owns the transport — to blind-sign it on the device and hand back the raw
 * `(r, s)`. This controller is that consumer: given one pending request it
 * resolves a live device client (silent reconnect, else a gesture-gated connect),
 * drives `signHash(path, hash)` on the device, and reports the outcome to the
 * background queue.
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
import { type LedgerDeviceClient, ledgerSignHashOnDevice } from "./client";
import { asLedgerRejection, type LedgerRejectionCode, ledgerMessage } from "./errors";
import type { LedgerSignOutcome } from "./runtime-client";

/**
 * A source of a live device client. `openConnected` attempts a SILENT reconnect
 * of an already-granted device (resolving `null` when none is connected, so the
 * caller falls back to a gesture); `request` runs the gesture-gated native
 * picker and MUST be called from a user click. Both may reject with a
 * {@link LedgerRejection}.
 */
export type LedgerConnector = {
  readonly openConnected: () => Promise<LedgerDeviceClient | null>;
  readonly request: () => Promise<LedgerDeviceClient>;
};

/**
 * The device-prompt phase the panel renders for the active request.
 * `connect` needs a user gesture (no granted device); `confirming` is the
 * on-device wait; `error` carries a catalog code and its user-facing copy.
 */
export type LedgerSignPhase =
  | { readonly kind: "connect" }
  | { readonly kind: "confirming" }
  | { readonly kind: "error"; readonly code: LedgerRejectionCode; readonly message: string };

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
 * by design: it fulfils one request at a time (WebHID is a serial pipe) and
 * ignores a second `present` while one is active. `present` starts a silent
 * reconnect; `connect` runs the gesture-gated picker for the connect state;
 * `retry` re-drives the device after a recoverable error (unlock, enable blind
 * signing) against the SAME parked request; `cancel` reports a clean rejection.
 */
export const createLedgerSignController = (
  deps: LedgerSignControllerDeps,
): LedgerSignController => {
  let current: LedgerSignRequestSummary | null = null;
  let busy = false;

  const show = (phase: LedgerSignPhase): void => {
    if (current) {
      deps.render({ phase, request: current });
    }
  };

  const signWith = async (client: LedgerDeviceClient): Promise<void> => {
    const request = current;
    if (!request) {
      return;
    }
    show({ kind: "confirming" });
    const signature = await ledgerSignHashOnDevice(client, request.path, request.messageHash);
    await deps.report({ id: request.id, r: signature.r, s: signature.s });
    current = null;
    deps.render(null);
  };

  // Resolves a client through `obtain`, then blind-signs. A `null` client (no
  // granted device) parks the connect state for a gesture; any thrown
  // device/transport failure becomes a typed error state, leaving the request
  // parked so a retry or cancel can still resolve it (nothing submitted).
  const drive = async (obtain: () => Promise<LedgerDeviceClient | null>): Promise<void> => {
    if (!current || busy) {
      return;
    }
    busy = true;
    try {
      const client = await obtain();
      if (client) {
        await signWith(client);
      } else {
        show({ kind: "connect" });
      }
    } catch (error) {
      show(errorPhase(asLedgerRejection(error).code));
    } finally {
      busy = false;
    }
  };

  return {
    activeId: () => current?.id ?? null,
    async cancel() {
      const request = current;
      if (!request) {
        return;
      }
      current = null;
      deps.render(null);
      await deps.report({ error: "rejected-on-device", id: request.id });
    },
    connect() {
      void drive(deps.connector.request);
    },
    present(request) {
      if (current) {
        return;
      }
      current = request;
      void drive(deps.connector.openConnected);
    },
    retry() {
      void drive(deps.connector.openConnected);
    },
  };
};
