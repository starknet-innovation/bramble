/**
 * Browser-owned Ledger device/session capability types.
 */
import type { LedgerDeviceClient } from "@mc-wallet/ledger-protocol/client";

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
