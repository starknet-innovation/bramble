/**
 * Typed surface for the grant-window-only Ledger transport selector.
 */
import type { LedgerTransport } from "../sidepanel/ledger/webhid-impl";

/**
 * Browser transport choices shown by the hardware window
 */
export type LedgerTransportKind = "ble" | "usb" | "hid";

/**
 * Lists transport families supported by the current browser.
 */
export function supportedGrantTransportKinds(): readonly LedgerTransportKind[];

/**
 * Opens one user-selected transport from a direct click in the top-level
 * hardware window
 */
export function requestGrantTransport(kind: LedgerTransportKind): Promise<LedgerTransport>;

/**
 * Safe browser diagnostics for a failed grant. Counts include only devices
 * already granted to this extension origin and never include names, serials,
 * identifiers, account data, or raw browser errors.
 */
export type LedgerGrantTransportDiagnostics = {
  readonly apiAvailable: boolean;
  readonly grantedDeviceCount: number | null;
};

/**
 * Reads non-sensitive browser capability and prior-grant state after a failed
 * chooser without requesting new authority.
 */
export function readGrantTransportDiagnostics(
  kind: LedgerTransportKind,
): Promise<LedgerGrantTransportDiagnostics>;

/**
 * Releases the transport and explicitly disconnects retained Bluetooth GATT
 * state. Teardown errors never authorize or complete a wallet operation.
 */
export function closeGrantTransport(
  kind: LedgerTransportKind,
  transport: LedgerTransport,
): Promise<void>;
