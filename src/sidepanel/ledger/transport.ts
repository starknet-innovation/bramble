/**
 * WebHID transport boundary for the side panel — the ONE place a live Ledger
 * device is opened. It must run in a Window context (the side panel), never
 * the service worker. Only a SILENT reconnect of an already-granted device
 * lives here: Chrome cannot render the WebHID device chooser inside an
 * extension side panel (the picker resolves with an empty list there, even
 * though the device shows in `chrome://device-log`), so the one-time grant
 * itself is obtained in a separate popup window (`./grant-window`, driven by
 * `./sign-connector.ts`) and this module only ever reopens what that popup
 * already granted. Construction wraps the transport in the
 * `@ledgerhq/hw-app-starknet` `StarknetClient`, exposed through the structural
 * {@link LedgerDeviceClient} so the rest of the flow stays hardware-agnostic
 * and testable.
 *
 * The concrete Ledger libraries are imported only from the runtime-only
 * `webhid-impl.js` shim (their vendored `.d.ts` does not compile under the
 * repo's pinned `skipLibCheck: false`), so this typed module maps open failures
 * to the {@link LedgerRejection} catalog and never touches those declarations.
 * Device I/O cannot be exercised without a real Ledger and Chromium WebHID, so
 * it is deliberately thin: all decision logic lives in `client.ts` (tested).
 */
import type { LedgerDeviceClient } from "./client";
import { LedgerRejection } from "./errors";
import type { LedgerDeviceChoice } from "./sign-session";
import {
  type LedgerTransport,
  listConnectedDevicesRaw,
  newStarknetClient,
  openConnectedTransportRaw,
} from "./webhid-impl";

type NavigatorWithHid = { readonly hid?: unknown };

/**
 * True when the runtime exposes WebHID (Chromium). Gate the connect entry point
 * on this and show `webhid-unavailable` otherwise.
 */
export const isWebHidAvailable = (): boolean =>
  typeof navigator !== "undefined" && (navigator as NavigatorWithHid).hid !== undefined;

const mapOpenError = (error: unknown): LedgerRejection => {
  const text = error instanceof Error ? `${error.name} ${error.message}` : "";
  if (/already open|in use|claimed|busy/i.test(text)) {
    return new LedgerRejection("device-busy");
  }
  return new LedgerRejection("unexpected-device-error");
};

/**
 * Silently reopens an already-granted device (no permission prompt). Returns
 * null when no granted device is connected, so the caller can fall back to the
 * grant-window popup (`./grant-window`'s `requestDeviceGrant`, driven by
 * `./sign-connector.ts`) and retry. The WebHID grant is origin-wide and
 * survives restarts, so this is the normal reconnect path — used on every
 * connect, not only the first one after a grant.
 */
export const openConnectedTransport = async (
  deviceId?: string,
): Promise<LedgerTransport | null> => {
  try {
    return await openConnectedTransportRaw(deviceId);
  } catch (error) {
    throw mapOpenError(error);
  }
};

/**
 * Lists every already-granted connected Ledger without opening it. Opaque ids
 * let the UI select one exact device when several are connected; no key,
 * address, or other wallet material is included in the descriptor.
 */
export const listConnectedDevices = async (): Promise<readonly LedgerDeviceChoice[]> => {
  try {
    return await listConnectedDevicesRaw();
  } catch (error) {
    throw mapOpenError(error);
  }
};

/**
 * Wraps an open transport in the Starknet APDU client used by the device flow.
 */
export const deviceClientFrom = (transport: LedgerTransport): LedgerDeviceClient =>
  newStarknetClient(transport);

/**
 * Closes an open transport, releasing the WebHID device so it is not left
 * claimed. Propagates any close error to the caller, which closes in a `finally`
 * and must not let a close failure mask the operation's real result (fail
 * closed). This is the counterpart to {@link openConnectedTransport}; the
 * device is opened and closed only here.
 */
export const closeTransport = (transport: LedgerTransport): Promise<void> => transport.close();
