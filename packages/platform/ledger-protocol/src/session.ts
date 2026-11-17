/**
 * Browser-owned Ledger device/session capability types.
 */
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";

/**
 * A live device client paired with mandatory transport teardown.
 */
export type LedgerDeviceSession = {
  readonly client: LedgerDeviceClient;
  readonly close: () => Promise<void>;
  readonly readiness?: "verified";
};

/**
 * Non-secret descriptor for one connected, origin-granted Ledger.
 */
export type LedgerDeviceChoice = {
  readonly id: string;
  readonly label: string;
};

/**
 * Browser capability for obtaining an owned Ledger session.
 */
export type LedgerConnector = {
  /**
   * Whether this runtime can reach a Ledger at all: a browser that exposes Web
   * Bluetooth, WebUSB or WebHID. This is a UI affordance signal only, never an
   * authorization: every device operation still fails closed at the transport,
   * so the answer decides whether a Ledger option is offered, not whether one
   * may be used. Absent is read as available, so a connector that does not
   * report capability keeps the offered state.
   */
  readonly isAvailable?: () => boolean;
  readonly listConnected?: () => Promise<readonly LedgerDeviceChoice[]>;
  readonly openConnected: (deviceId?: string) => Promise<LedgerDeviceSession | null>;
  readonly request: () => Promise<LedgerDeviceSession>;
};

/**
 * Releases an owned session without masking its operation result.
 */
export const closeLedgerSessionQuietly = async (session: LedgerDeviceSession): Promise<void> => {
  await session.close().catch(() => undefined);
};
