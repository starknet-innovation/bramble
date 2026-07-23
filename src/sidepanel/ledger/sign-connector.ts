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
 * `ledger-grant.html` popup window (`./grant-window`), where the native
 * picker does work, then retries the silent reconnect once more before giving
 * up. This is the one seam that touches real hardware, so it is deliberately
 * logic-free (all other decisions live in ./sign-session.ts) and is exercised
 * only against a physical Ledger — wired-but-untested by unit tests, which
 * inject a fake {@link LedgerConnector} instead.
 */
import { LedgerRejection } from "./errors";
import { extensionBrowser, requestDeviceGrant } from "./grant-window";
import type { LedgerConnector, LedgerDeviceSession } from "./sign-session";
import { closeTransport, deviceClientFrom, openConnectedTransport } from "./transport";
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
 * Connector backed by `@ledgerhq/hw-transport-webhid`. `request` never shows a
 * device picker itself: it reconnects silently first, and only pops the
 * `ledger-grant.html` grant window when there is no existing grant to reuse.
 * Both methods return an OWNED {@link LedgerDeviceSession} whose `close`
 * releases the WebHID transport; the caller MUST close it (success, failure,
 * retry, or cancel) or the device stays claimed.
 */
export const webHidConnector: LedgerConnector = {
  async openConnected() {
    const transport = await openConnectedTransport();
    return transport ? sessionFrom(transport) : null;
  },
  async request() {
    const reconnected = await openConnectedTransport();
    if (reconnected) {
      return sessionFrom(reconnected);
    }

    const browser = extensionBrowser();
    if (browser) {
      await requestDeviceGrant(browser);
    }

    const granted = await openConnectedTransport();
    if (granted) {
      return sessionFrom(granted);
    }

    throw new LedgerRejection("picker-cancelled");
  },
};
