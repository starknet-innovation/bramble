/**
 * Hand-written type surface for the runtime-only browser Ledger transport
 * boundary. It exposes only the WebUSB/WebHID/StarknetClient
 * operations the wallet uses, so the Ledger packages' incompatible
 * declarations never enter the strict TypeScript program.
 */
import type { LedgerDeviceClient } from "./client";
import type { LedgerDeviceIdentity, LedgerTransitionPhase } from "./device-transition";
import type { LedgerDeviceChoice } from "./sign-session";

/**
 * Cable transports available to the side-panel reconnect path.
 */
export type LedgerTransportKind = "usb" | "hid";

/**
 * An open Ledger transport handle. Opaque to typed code: callers can only close
 * it or construct the structural Starknet client through
 * {@link newStarknetClient}.
 */
export type LedgerTransport = {
  close(): Promise<void>;
};

/**
 * Runtime transport shape kept inside the browser hardware boundary.
 */
export type LedgerRawTransport = {
  close(): Promise<void>;
  send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data: Uint8Array,
    statusList: readonly number[],
  ): Promise<Uint8Array>;
};

/**
 * Exact browser-device operations retained for a reconnecting session.
 */
export type LedgerTransportBinding<Device extends LedgerDeviceIdentity = LedgerDeviceIdentity> = {
  readonly disconnect?: () => Promise<void>;
  readonly listDevices: () => Promise<readonly Device[]>;
  readonly openDevice: (device: Device) => Promise<LedgerRawTransport>;
  readonly selectedDevice: Device;
};

/**
 * Binds a raw browser transport to its exact selected device so app-changing
 * APDUs can reconnect without falling back to browser list order.
 */
export function bindLedgerTransportRaw<Device extends LedgerDeviceIdentity>(
  initial: LedgerRawTransport,
  binding: LedgerTransportBinding<Device>,
): LedgerTransport;

/**
 * Reopens an already-granted device without a prompt. Resolves null when no
 * granted device is connected, so the caller can open the dedicated grant tab
 * and retry.
 */
export function openConnectedTransportRaw(deviceId?: string): Promise<LedgerTransport | null>;

/**
 * Lists already-granted connected Ledger devices without opening one. Device
 * ids are opaque and valid only within the current side-panel context.
 */
export function listConnectedDevicesRaw(): Promise<readonly LedgerDeviceChoice[]>;

/**
 * Returns the browser Ledger transports available in this extension page.
 */
export function supportedTransportKindsRaw(): Promise<readonly LedgerTransportKind[]>;

/**
 * Opens the browser-owned picker for one transport and returns the selected,
 * already-open device. Must be called from a user gesture.
 */
export function requestTransportRaw(kind: LedgerTransportKind): Promise<LedgerTransport>;

/**
 * Wraps an open transport in the Starknet APDU client, exposed through the
 * structural {@link LedgerDeviceClient} so the rest of the flow stays
 * hardware-agnostic and testable.
 */
export function newStarknetClient(
  transport: LedgerTransport,
  onTransition?: (phase: LedgerTransitionPhase) => void,
): LedgerDeviceClient;
