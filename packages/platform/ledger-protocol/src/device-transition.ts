/**
 * Ledger dashboard/app transition used by the browser transport boundary.
 * App changes physically disconnect the browser transport on supported Ledger
 * devices, so every transition is followed by an exact-device reconnect and a
 * state confirmation before the next APDU is allowed. Transport ownership and
 * device matching stay in `webhid-impl.js`; this module contains only the
 * deterministic protocol state machine.
 */

export type LedgerTransitionPhase =
  | "checking-device"
  | "returning-to-dashboard"
  | "reconnecting-dashboard"
  | "checking-firmware"
  | "opening-starknet"
  | "reconnecting-starknet"
  | "confirming-starknet";

/**
 * Raw OS version fields returned by Ledger's dashboard command.
 */
export type LedgerOsVersionResponse = {
  readonly targetId: number;
  readonly version: string;
};

/**
 * Minimal reconnecting APDU port. `reconnect` must reopen the exact device that
 * supplied the current transport and reject rather than selecting a sibling.
 */
export type LedgerTransitionPort = {
  readonly reconnect: () => Promise<void>;
  readonly send: (
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data: Uint8Array,
    statusList: readonly number[],
  ) => Promise<Uint8Array>;
};

/**
 * Browser-owned fields that can bind a reconnect to one granted device.
 */
export type LedgerDeviceIdentity = {
  readonly id?: unknown;
  readonly productName?: unknown;
  readonly serialNumber?: unknown;
  readonly vendorId?: unknown;
};

const nonEmptyIdentity = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * Finds only the exact previously selected device. Browser object identity is
 * preferred; Web Bluetooth's origin-scoped id and WebUSB's vendor-bound serial
 * are accepted only when they identify exactly one candidate. Labels, product
 * names, and list order are never identity and therefore never select a device.
 */
export const exactLedgerDevice = <Device extends LedgerDeviceIdentity>(
  selected: Device,
  candidates: readonly Device[],
): Device | null => {
  const sameObject = candidates.filter((candidate) => candidate === selected);
  if (sameObject.length === 1) {
    return sameObject[0] ?? null;
  }

  const selectedId = nonEmptyIdentity(selected.id);
  if (selectedId) {
    const matchingId = candidates.filter(
      (candidate) => nonEmptyIdentity(candidate.id) === selectedId,
    );
    return matchingId.length === 1 ? (matchingId[0] ?? null) : null;
  }

  const selectedSerial = nonEmptyIdentity(selected.serialNumber);
  if (selectedSerial && typeof selected.vendorId === "number") {
    const matchingSerial = candidates.filter(
      (candidate) =>
        candidate.vendorId === selected.vendorId &&
        nonEmptyIdentity(candidate.serialNumber) === selectedSerial,
    );
    return matchingSerial.length === 1 ? (matchingSerial[0] ?? null) : null;
  }
  return null;
};

const APDU_OK = 0x9000;
const APP_STATE_APDU = { cla: 0xb0, ins: 0x01, p1: 0, p2: 0 };
const OS_VERSION_APDU = { cla: 0xe0, ins: 0x01, p1: 0, p2: 0 };
const QUIT_APP_APDU = { cla: 0xb0, ins: 0xa7, p1: 0, p2: 0 };
const OPEN_APP_APDU = { cla: 0xe0, ins: 0xd8, p1: 0, p2: 0 };
const DASHBOARD_NAMES: ReadonlySet<string> = new Set(["BOLOS", "OLOS", "OLOS\u0000"]);
const STARKNET_APP_NAME = "Starknet";
const MAX_MANAGEMENT_RESPONSE_BYTES = 260;
const MAX_APP_NAME_BYTES = 64;
const MAX_VERSION_BYTES = 32;
const MAX_FLAGS_BYTES = 64;
const MAX_TRAILING_FIELD_BYTES = 64;
const MAX_OS_TRAILING_FIELDS = 5;

const malformedResponse = (): Error => new Error("Malformed Ledger management response");

const byteAt = (response: Uint8Array, offset: number): number => {
  const value = response[offset];
  if (value === undefined) {
    throw malformedResponse();
  }
  return value;
};

const statusOffsetOf = (response: Uint8Array): number => {
  if (
    !(response instanceof Uint8Array) ||
    response.length < 2 ||
    response.length > MAX_MANAGEMENT_RESPONSE_BYTES
  ) {
    throw malformedResponse();
  }
  const offset = response.length - 2;
  if ((byteAt(response, offset) << 8) + byteAt(response, offset + 1) !== APDU_OK) {
    throw new Error("Ledger management command failed");
  }
  return offset;
};

const readLv = (
  response: Uint8Array,
  offset: number,
  statusOffset: number,
  maximumLength: number,
): { readonly nextOffset: number; readonly value: Uint8Array } => {
  if (offset >= statusOffset) {
    throw malformedResponse();
  }
  const length = byteAt(response, offset);
  const valueOffset = offset + 1;
  const nextOffset = valueOffset + length;
  if (length > maximumLength || nextOffset > statusOffset) {
    throw malformedResponse();
  }
  return { nextOffset, value: response.slice(valueOffset, nextOffset) };
};

const decode = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw malformedResponse();
  }
};

const isPrintableVersion = (value: string): boolean => /^[\x20-\x7e]+$/.test(value);

const parseAppState = (
  response: Uint8Array,
): { readonly name: string; readonly version: string } => {
  const statusOffset = statusOffsetOf(response);
  if (statusOffset < 1 || response[0] !== 1) {
    throw malformedResponse();
  }
  const name = readLv(response, 1, statusOffset, MAX_APP_NAME_BYTES);
  const version = readLv(response, name.nextOffset, statusOffset, MAX_VERSION_BYTES);
  let offset = version.nextOffset;
  if (offset < statusOffset) {
    offset = readLv(response, offset, statusOffset, MAX_FLAGS_BYTES).nextOffset;
  }
  if (offset !== statusOffset) {
    throw malformedResponse();
  }
  return { name: decode(name.value), version: decode(version.value) };
};

const parseOsVersion = (response: Uint8Array): LedgerOsVersionResponse => {
  const statusOffset = statusOffsetOf(response);
  if (statusOffset < 6) {
    throw malformedResponse();
  }
  const targetId =
    byteAt(response, 0) * 0x1000000 +
    byteAt(response, 1) * 0x10000 +
    byteAt(response, 2) * 0x100 +
    byteAt(response, 3);
  const version = readLv(response, 4, statusOffset, MAX_VERSION_BYTES);
  if (version.value.length === 0) {
    throw malformedResponse();
  }
  const flags = readLv(response, version.nextOffset, statusOffset, MAX_FLAGS_BYTES);
  const mcuVersion = readLv(response, flags.nextOffset, statusOffset, MAX_VERSION_BYTES);
  if (!isPrintableVersion(decode(mcuVersion.value))) {
    throw malformedResponse();
  }
  let offset = mcuVersion.nextOffset;
  let trailingFields = 0;
  while (offset < statusOffset) {
    trailingFields += 1;
    if (trailingFields > MAX_OS_TRAILING_FIELDS) {
      throw malformedResponse();
    }
    offset = readLv(response, offset, statusOffset, MAX_TRAILING_FIELD_BYTES).nextOffset;
  }
  return { targetId, version: decode(version.value) };
};

const send = (
  port: LedgerTransitionPort,
  apdu: { readonly cla: number; readonly ins: number; readonly p1: number; readonly p2: number },
  data: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array> => port.send(apdu.cla, apdu.ins, apdu.p1, apdu.p2, data, [APDU_OK]);

const isDisconnect = (error: unknown): boolean => {
  const text = error instanceof Error ? `${error.name} ${error.message}` : "";
  return /disconnect|connection.+lost|gatt.+not connected|device.+unavailable/i.test(text);
};

const emit = (
  onPhase: ((phase: LedgerTransitionPhase) => void) | undefined,
  phase: LedgerTransitionPhase,
): void => {
  try {
    onPhase?.(phase);
  } catch {
    // A presentation callback must never change the hardware trust decision.
  }
};

const appState = async (port: LedgerTransitionPort): Promise<{ readonly name: string }> =>
  parseAppState(await send(port, APP_STATE_APDU));

const sendDisconnecting = async (
  operation: () => Promise<unknown>,
  port: LedgerTransitionPort,
  reconnectingPhase: LedgerTransitionPhase,
  onPhase?: (phase: LedgerTransitionPhase) => void,
): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    if (!isDisconnect(error)) {
      throw error;
    }
  }
  emit(onPhase, reconnectingPhase);
  await port.reconnect();
};

/**
 * Reads firmware on the dashboard and restores Starknet before returning.
 * The current app is detected first, dashboard starts skip CloseApp, and every
 * disconnecting transition is accepted only after reconnecting the exact
 * selected device and confirming its resulting state. Unknown states, wrong
 * devices, malformed replies, and failed reconnections all fail closed.
 */
export const readLedgerOsAndRestoreStarknet = async (
  port: LedgerTransitionPort,
  onPhase?: (phase: LedgerTransitionPhase) => void,
): Promise<LedgerOsVersionResponse> => {
  emit(onPhase, "checking-device");
  const initial = await appState(port);
  if (!DASHBOARD_NAMES.has(initial.name)) {
    emit(onPhase, "returning-to-dashboard");
    await sendDisconnecting(
      () => send(port, QUIT_APP_APDU),
      port,
      "reconnecting-dashboard",
      onPhase,
    );
    const dashboard = await appState(port);
    if (!DASHBOARD_NAMES.has(dashboard.name)) {
      throw new Error("Ledger did not return to the dashboard");
    }
  }

  emit(onPhase, "checking-firmware");
  let osVersion: LedgerOsVersionResponse | undefined;
  let osError: unknown;
  try {
    osVersion = parseOsVersion(await send(port, OS_VERSION_APDU));
  } catch (error) {
    osError = error;
  }

  try {
    emit(onPhase, "opening-starknet");
    await sendDisconnecting(
      () => send(port, OPEN_APP_APDU, new TextEncoder().encode(STARKNET_APP_NAME)),
      port,
      "reconnecting-starknet",
      onPhase,
    );
    emit(onPhase, "confirming-starknet");
    const restored = await appState(port);
    if (restored.name !== STARKNET_APP_NAME) {
      throw new Error("Ledger did not open Starknet");
    }
  } catch (error) {
    if (osError === undefined) {
      throw error;
    }
  }

  if (osError !== undefined) {
    throw osError;
  }
  if (!osVersion) {
    throw malformedResponse();
  }
  return osVersion;
};
