/**
 * The live WebHID {@link LedgerConnector} used by the side-panel signing runtime.
 * A thin adapter over the transport boundary: it turns an open transport into a
 * typed device client, mapping "no granted device" to a popup-window grant and
 * only a persistent miss to a {@link LedgerRejection}. Chrome cannot render the
 * WebHID device chooser inside the extension side panel —
 * `navigator.hid.requestDevice()` resolves with an empty list there, even
 * though the device shows in `chrome://device-log` — so `request` never calls
 * the picker directly. It retries a silent reconnect
 * ({@link openConnectedTransport}) first, and only on a miss opens the small
 * `ledger-grant.html` popup window (`./grant-window`), where the native picker
 * does work, then retries the silent reconnect once more before giving up.
 * Already-granted devices are listed first so the controller can ask the user
 * to choose explicitly when more than one is connected. This is the one seam
 * that touches real hardware; controller decisions are tested through injected
 * connectors, while this adapter itself requires a physical Ledger.
 */
import { LedgerRejection } from "./errors";
import { extensionBrowser, requestDeviceGrant } from "./grant-window";
import type { LedgerConnector, LedgerDeviceSession } from "./sign-session";
import {
  closeTransport,
  deviceClientFrom,
  listConnectedDevices,
  openConnectedTransport,
} from "./transport";
import type { LedgerTransport } from "./webhid-impl";

// Turns an open transport into an OWNED session: the device client plus a `close`
// that releases the transport. The whole point of the session is that whoever
// opens the device also gets the handle to close it — the transport is no longer
// discarded, so the flow can release it in a `finally` on every outcome.
const sessionFrom = (transport: LedgerTransport): LedgerDeviceSession => ({
  client: deviceClientFrom(transport),
  close: () => closeTransport(transport),
});

/**
 * Connector backed by `@ledgerhq/hw-transport-webhid`. `listConnected` exposes
 * non-secret chooser labels and opaque ids for already-granted devices.
 * `request` never shows a device picker in the side panel: it reconnects
 * silently first, and only pops the `ledger-grant.html` grant window when there
 * is no existing grant to reuse. Both open methods return an OWNED
 * {@link LedgerDeviceSession} whose `close` releases the WebHID transport; the
 * caller MUST close it (success, failure, retry, or cancel) or the device stays
 * claimed.
 */
export const webHidConnector: LedgerConnector = {
  listConnected: listConnectedDevices,
  async openConnected(deviceId) {
    const transport = await openConnectedTransport(deviceId);
    return transport ? sessionFrom(transport) : null;
  },
  async request() {
    const connected = await listConnectedDevices();
    if (connected.length > 1) {
      throw new LedgerRejection("multiple-devices");
    }
    const reconnected = await openConnectedTransport(connected[0]?.id);
    if (reconnected) {
      return sessionFrom(reconnected);
    }

    const browser = extensionBrowser();
    if (browser) {
      await requestDeviceGrant(browser);
    }

    const grantedDevices = await listConnectedDevices();
    if (grantedDevices.length > 1) {
      throw new LedgerRejection("multiple-devices");
    }
    const granted = await openConnectedTransport(grantedDevices[0]?.id);
    if (granted) {
      return sessionFrom(granted);
    }

    throw new LedgerRejection("picker-cancelled");
  },
};
