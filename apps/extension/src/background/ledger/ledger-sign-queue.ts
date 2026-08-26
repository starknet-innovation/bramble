/**
 * The Ledger binding of the shared device sign queue. The parking, session
 * boundary, timeout, and fail-closed rules live once in
 * {@link createDeviceSignQueue}; this file only fixes what a Ledger is handed
 * (a {@link LedgerSignRequest}) and hands back (a raw `(r, s)`), and names the
 * device in the queue ids so a settle meant for another device cannot address a
 * Ledger's parked request.
 */
import type { DeviceSignature } from "@mc-wallet/wallet-model/signing";
import {
  createDeviceSignQueue,
  type DeviceSignQueue,
  type DeviceSignQueueTimeout,
  type PendingDeviceSign,
} from "../devices/device-sign-queue";
import type { LedgerSignRequest } from "./ledger-signer";

/**
 * A pending Ledger request the side panel must fulfil on the device.
 */
export type PendingLedgerSign = PendingDeviceSign<LedgerSignRequest>;

/**
 * Injected bounded timeout for a parked Ledger request.
 */
export type LedgerSignQueueTimeout = DeviceSignQueueTimeout;

/**
 * Coordinates background sign requests with the panel that owns the device.
 */
export type LedgerSignQueue = DeviceSignQueue<LedgerSignRequest, DeviceSignature>;

/**
 * Creates the Ledger sign queue. Arguments carry the meanings documented on
 * {@link createDeviceSignQueue}.
 */
export const createLedgerSignQueue = (
  onRequest?: () => void,
  timeout?: LedgerSignQueueTimeout,
  currentGeneration?: () => number | null,
): LedgerSignQueue =>
  createDeviceSignQueue<LedgerSignRequest, DeviceSignature>(
    "ledger-sign",
    onRequest,
    timeout,
    currentGeneration,
  );
