/**
 * The live WebHID {@link LedgerConnector} used by the side-panel signing runtime.
 * A thin adapter over the transport boundary: it turns an open transport into a
 * typed device client, mapping "no granted device" to `null` so the controller
 * falls back to a gesture. This is the one seam that touches real hardware, so
 * it is deliberately logic-free (all decisions live in ./sign-session.ts) and is
 * exercised only against a physical Ledger — wired-but-untested by unit tests,
 * which inject a fake {@link LedgerConnector} instead.
 */
import type { LedgerConnector, LedgerDeviceSession } from "./sign-session";
import {
  closeTransport,
  deviceClientFrom,
  openConnectedTransport,
  requestTransport,
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
 * Connector backed by `@ledgerhq/hw-transport-webhid`. `request` MUST be invoked
 * from a user gesture (a click) in the side panel or WebHID throws. Both methods
 * return an OWNED {@link LedgerDeviceSession} whose `close` releases the WebHID
 * transport; the caller MUST close it (success, failure, retry, or cancel) or
 * the device stays claimed.
 */
export const webHidConnector: LedgerConnector = {
  async openConnected() {
    const transport = await openConnectedTransport();
    return transport ? sessionFrom(transport) : null;
  },
  async request() {
    return sessionFrom(await requestTransport());
  },
};
