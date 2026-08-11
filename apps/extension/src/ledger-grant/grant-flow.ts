/**
 * Pure selection and failure policy for the standalone Ledger grant page.
 * Browser/device effects stay in the runtime-only transport boundary; this
 * module decides which supported transport to try and reduces raw browser
 * failures to fixed, non-sensitive categories.
 */
import type {
  LedgerGrantTransportDiagnostics,
  LedgerTransportKind,
} from "@mc-wallet/ledger-browser/grant-transport";

/**
 * User-visible connection choices. Cable contains both WebUSB and WebHID
 * implementations; Bluetooth is never inferred from browser capability.
 */
export type LedgerConnectionMethod = "cable" | "ble";

/**
 * Selects the cable path before Bluetooth. Browser capability detection cannot
 * reveal which physical Ledger is attached, and Nano S Plus has no Bluetooth,
 * so the presence of `navigator.bluetooth` must never steer the user away from
 * an attached cable. WebHID and Bluetooth remain explicit compatibility paths.
 */
export const preferredLedgerTransport = (
  supported: readonly LedgerTransportKind[],
): LedgerTransportKind | null =>
  supported.includes("usb")
    ? "usb"
    : supported.includes("hid")
      ? "hid"
      : supported.includes("ble")
        ? "ble"
        : null;

/**
 * Returns the other supported transport after a transport-interface failure.
 */
export const alternateLedgerTransport = (
  current: LedgerTransportKind,
  supported: readonly LedgerTransportKind[],
): LedgerTransportKind | null => {
  const order: readonly LedgerTransportKind[] = ["usb", "hid", "ble"];
  const currentIndex = order.indexOf(current);
  for (let offset = 1; offset < order.length; offset += 1) {
    const candidate = order[(currentIndex + offset) % order.length];
    if (candidate && supported.includes(candidate)) {
      return candidate;
    }
  }
  return null;
};

/**
 * Resolves one explicit connection method to a concrete browser transport.
 * A retry is retained only while it belongs to the same user-selected method.
 */
export const transportForConnectionMethod = (
  method: LedgerConnectionMethod,
  supported: readonly LedgerTransportKind[],
  retry: LedgerTransportKind | null,
): LedgerTransportKind | null => {
  const allowed = supported.filter((transport) =>
    method === "ble" ? transport === "ble" : transport !== "ble",
  );
  return retry && allowed.includes(retry) ? retry : preferredLedgerTransport(allowed);
};

/**
 * Non-sensitive browser failure categories safe to render in the grant tab.
 * Raw device and transport details never cross this policy boundary.
 */
export type LedgerGrantFailure =
  | "permission-dismissed"
  | "permission-blocked"
  | "interface-unavailable"
  | "transport-unavailable"
  | "unexpected";

/**
 * Classifies browser/transport permission failures without surfacing raw
 * messages. The fixed result controls recovery copy and the support diagnostic
 * id; it never authorizes a device or account action.
 */
export const ledgerGrantFailure = (error: unknown): LedgerGrantFailure => {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "AbortError" || name === "NotFoundError" || name === "TransportOpenUserCancelled") {
    return "permission-dismissed";
  }
  if (name === "SecurityError" || name === "NotAllowedError") {
    return "permission-blocked";
  }
  if (name === "TransportNotSupported") {
    return "transport-unavailable";
  }
  if (
    name === "TransportInterfaceNotAvailable" ||
    /claim interface|interface.+unavailable|unable to claim/i.test(message)
  ) {
    return "interface-unavailable";
  }
  return "unexpected";
};

/**
 * Formats a fixed, copyable diagnostic without device identity or raw error
 * content. A saved-grant count describes only this extension origin and cannot
 * reveal another site's permissions.
 */
export const ledgerGrantDiagnostic = (
  supportCode: string,
  diagnostics: LedgerGrantTransportDiagnostics,
): string => {
  const api = diagnostics.apiAvailable ? "API ready" : "API unavailable";
  const grants =
    diagnostics.grantedDeviceCount === null
      ? "saved grants unavailable"
      : `saved grants ${diagnostics.grantedDeviceCount}`;
  return `Support code · ${supportCode} · ${api} · ${grants}`;
};
