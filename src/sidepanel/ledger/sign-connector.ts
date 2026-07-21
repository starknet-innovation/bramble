/**
 * The live WebHID {@link LedgerConnector} used by the side-panel signing runtime.
 * A thin adapter over the transport boundary: it turns an open transport into a
 * typed device client, mapping "no granted device" to `null` so the controller
 * falls back to a gesture. This is the one seam that touches real hardware, so
 * it is deliberately logic-free (all decisions live in ./sign-session.ts) and is
 * exercised only against a physical Ledger — wired-but-untested by unit tests,
 * which inject a fake {@link LedgerConnector} instead.
 */
import type { LedgerConnector } from "./sign-session";
import { deviceClientFrom, openConnectedTransport, requestTransport } from "./transport";

/**
 * Connector backed by `@ledgerhq/hw-transport-webhid`. `request` MUST be invoked
 * from a user gesture (a click) in the side panel or WebHID throws.
 */
export const webHidConnector: LedgerConnector = {
  async openConnected() {
    const transport = await openConnectedTransport();
    return transport ? deviceClientFrom(transport) : null;
  },
  async request() {
    return deviceClientFrom(await requestTransport());
  },
};
