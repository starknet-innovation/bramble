/**
 * Browser transport boundary for the side panel — the ONE place a live Ledger
 * device is opened after permission is granted. It must run in a Window
 * context, never the service worker. This module silently reopens origin-granted
 * WebUSB/WebHID cable devices. The standalone grant tab separately owns Web
 * Bluetooth for the current operation because stable Chrome cannot enumerate
 * paired Bluetooth devices for a silent reopen. Construction wraps the transport in the
 * `@ledgerhq/hw-app-starknet` `StarknetClient`, exposed through the structural
 * {@link LedgerDeviceClient} so the rest of the flow stays hardware-agnostic
 * and testable.
 *
 * The concrete Ledger libraries are imported only from the runtime-only
 * `webhid-impl.js` shim (their vendored `.d.ts` does not compile under the
 * repo's pinned `skipLibCheck: false`), so this typed module maps open failures
 * to the {@link LedgerRejection} catalog and never touches those declarations.
 * Device I/O cannot be exercised without a real Ledger and Chromium, so
 * it is deliberately thin: all decision logic lives in `client.ts` (tested).
 */

import {
  type LedgerTransport,
  listConnectedDevicesRaw,
  newStarknetClient,
  openConnectedTransportRaw,
} from "@bramble/ledger-browser/webhid";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";
import type { LedgerDeviceChoice } from "@bramble/ledger-protocol/session";

type NavigatorWithLedgerTransport = {
  readonly bluetooth?: unknown;
  readonly hid?: unknown;
  readonly usb?: unknown;
};

/**
 * True when the runtime exposes Web Bluetooth, WebUSB, or WebHID. This is
 * capability detection, not a permission check; the grant tab still owns
 * the user gesture.
 */
export const isLedgerTransportAvailable = (): boolean =>
  typeof navigator !== "undefined" &&
  ((navigator as NavigatorWithLedgerTransport).bluetooth !== undefined ||
    (navigator as NavigatorWithLedgerTransport).usb !== undefined ||
    (navigator as NavigatorWithLedgerTransport).hid !== undefined);

const mapOpenError = (error: unknown): LedgerRejection => {
  const text = error instanceof Error ? `${error.name} ${error.message}` : "";
  if (/already open|in use|claimed|busy|claim interface|interface.+unavailable/i.test(text)) {
    return new LedgerRejection("device-busy");
  }
  return new LedgerRejection("unexpected-device-error");
};

/**
 * Silently reopens an already-granted device (no permission prompt). Returns
 * null when no granted device is connected, so the caller can fall back to the
 * grant tab (`./grant-window`'s `requestDeviceGrant`, driven by
 * `./sign-connector.ts`) and retry. Cable device grants are origin-wide and
 * survive restarts, so this is the normal cable reconnect path. Bluetooth
 * sessions are retained and proxied by the dedicated hardware tab instead.
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
 * Closes an open transport, releasing the browser device so it is not left
 * claimed. Propagates any close error to the caller, which closes in a `finally`
 * and must not let a close failure mask the operation's real result (fail
 * closed). This is the counterpart to {@link openConnectedTransport}; the
 * device is opened and closed only here.
 */
export const closeTransport = (transport: LedgerTransport): Promise<void> => transport.close();
