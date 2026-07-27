/**
 * Verifies that a newly granted browser transport can actually speak to the
 * Starknet app before the grant tab reports success. The transport is always
 * released; a close failure only replaces a successful probe, never the more
 * actionable app/device failure that happened first.
 */
import {
  assertLedgerAppReady,
  type LedgerAppVersion,
  type LedgerDeviceClient,
  ledgerPublicKeyX,
} from "../sidepanel/ledger/client";
import { ledgerAccountPath } from "../starknet/ledger-path";

/**
 * Narrow transport session used only to verify a newly granted Ledger.
 * Callers provide the device client and teardown operation; verification
 * always attempts teardown and never returns key material.
 */
export type LedgerGrantSession = {
  readonly client: LedgerDeviceClient;
  readonly close: () => Promise<void>;
};

/**
 * Probes the Starknet app version and derives the index-zero public key at the
 * wallet's canonical EIP-2645 path without taking ownership of the transport.
 * The public key is discarded; this is a transport/app/path compatibility
 * proof, not account creation. The retained-window broker uses this before it
 * reports ready, then keeps the same transport open for the caller's operation.
 */
export const probeLedgerGrantClient = async (
  client: LedgerDeviceClient,
): Promise<LedgerAppVersion> => {
  const version = await assertLedgerAppReady(client);
  await ledgerPublicKeyX(client, ledgerAccountPath(0));
  return version;
};

/**
 * Probes a granted session and always releases it. Retained for cable/grant
 * boundary tests and callers that do not transfer session ownership.
 */
export const verifyLedgerGrantSession = async (
  session: LedgerGrantSession,
): Promise<LedgerAppVersion> => {
  let version: LedgerAppVersion | undefined;
  let operationError: unknown;
  try {
    version = await probeLedgerGrantClient(session.client);
  } catch (error) {
    operationError = error;
  }

  try {
    await session.close();
  } catch (error) {
    if (operationError === undefined) {
      throw error;
    }
  }

  if (operationError !== undefined) {
    throw operationError;
  }
  if (!version) {
    throw new Error("Ledger grant probe returned no version");
  }
  return version;
};
