/**
 * The live browser {@link LedgerConnector} used by the side-panel signing
 * runtime. Web Bluetooth handles Nano X devices whose composite FIDO interface
 * Chrome blocks from WebHID; WebUSB and APDU-filtered WebHID remain cable
 * fallbacks. A thin adapter over the transport boundary turns an open cable
 * transport into a typed device client, mapping "no granted device" to the
 * top-level hardware tab. Chrome exposes the native hardware chooser only in
 * an ordinary tab; extension side panels and popup windows can return an empty
 * device list. `request` never opens a browser device picker
 * inside the side panel; it retries a silent cable reconnect first, and only on
 * a miss opens `ledger-grant.html`, which retains the selected transport for
 * this operation and presents it as a validated remote device session.
 * Already-granted devices are listed first so the controller can ask the user
 * to choose explicitly when more than one is connected. This is the one seam
 * that touches real hardware; controller decisions are tested through injected
 * connectors, while this adapter itself requires a physical Ledger.
 */

import { extensionBrowser, requestDeviceGrant } from "@bramble/ledger-browser/grant-window";
import {
  closeTransport,
  deviceClientFrom,
  isLedgerTransportAvailable,
  listConnectedDevices,
  openConnectedTransport,
} from "@bramble/ledger-browser/transport";
import type { LedgerTransport } from "@bramble/ledger-browser/webhid";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";
import type { LedgerConnector, LedgerDeviceSession } from "@bramble/ledger-protocol/session";

// Turns an open transport into an OWNED session: the device client plus a `close`
// that releases the transport. The whole point of the session is that whoever
// opens the device also gets the handle to close it — the transport is no longer
// discarded, so the flow can release it in a `finally` on every outcome.
const sessionFrom = (transport: LedgerTransport): LedgerDeviceSession => ({
  client: deviceClientFrom(transport),
  close: () => closeTransport(transport),
});

// One device session per page. The next open waits until this session's close
// has finished, so a cancel and a reconnect cannot claim the browser device
// at the same time. A thrown open releases the turn; a returned session holds
// it until `close`.
let sessionTurn: Promise<void> = Promise.resolve();

const withSessionTurn = async (
  open: () => Promise<LedgerDeviceSession | null>,
): Promise<LedgerDeviceSession | null> => {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = sessionTurn;
  sessionTurn = gate;
  await previous;
  try {
    const session = await open();
    if (!session) {
      release();
      return null;
    }
    let settled = false;
    return {
      client: session.client,
      ...(session.readiness ? { readiness: session.readiness } : {}),
      close: async () => {
        if (settled) return;
        settled = true;
        try {
          await session.close();
        } finally {
          release();
        }
      },
    };
  } catch (error) {
    release();
    throw error;
  }
};

const openCable = async (deviceId?: string): Promise<LedgerDeviceSession | null> => {
  const transport = await openConnectedTransport(deviceId);
  return transport ? sessionFrom(transport) : null;
};

const requestSession = async (): Promise<LedgerDeviceSession> => {
  // A runtime with no Ledger transport (Firefox has no WebHID, WebUSB or Web
  // Bluetooth) answers with the browser-support message at once, instead of
  // opening a grant tab that can only say the same thing.
  if (!isLedgerTransportAvailable()) {
    throw new LedgerRejection("webhid-unavailable");
  }
  const connected = await listConnectedDevices();
  if (connected.length > 1) {
    throw new LedgerRejection("multiple-devices");
  }
  const reconnected = await openCable(connected[0]?.id);
  if (reconnected) return reconnected;

  const browser = extensionBrowser();
  if (browser) return requestDeviceGrant(browser);
  throw new LedgerRejection("webhid-unavailable");
};

/**
 * Connector backed by Ledger's Web Bluetooth, WebUSB, and WebHID transports.
 * `listConnected` exposes non-secret chooser labels and opaque ids for
 * already-granted devices.
 * `request` never shows a device picker in the side panel: it refuses at once
 * with `webhid-unavailable` when the runtime has no Ledger transport, reconnects a
 * previously granted cable device first, then opens the hardware-owning
 * `ledger-grant.html` tab when no silent route is available. Both paths return an OWNED
 * {@link LedgerDeviceSession} whose `close` releases the browser transport; the
 * caller MUST close it (success, failure, retry, or cancel) or the device stays
 * claimed.
 */
export const ledgerConnector: LedgerConnector = {
  isAvailable: isLedgerTransportAvailable,
  listConnected: listConnectedDevices,
  openConnected(deviceId) {
    return withSessionTurn(() => openCable(deviceId));
  },
  async request() {
    const session = await withSessionTurn(requestSession);
    if (!session) throw new LedgerRejection("webhid-unavailable");
    return session;
  },
};
