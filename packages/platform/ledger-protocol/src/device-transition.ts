/**
 * Ledger dashboard/app transition used by the browser transport boundary.
 * App changes physically disconnect the browser transport on supported Ledger
 * devices, so every transition is followed by an exact-device reconnect and a
 * state confirmation before the next APDU is allowed. Transport ownership and
 * device matching stay in `webhid-impl.js`; this module contains only the
 * deterministic protocol state machine.
 *
 * Every failure here throws a typed {@link LedgerRejection} naming the step that
 * failed, never a bare `Error`. These run before any signing, on hardware this
 * build may never have seen, so an unclassified throw would reach the user as
 * the `unexpected-device-error` catch-all ("make sure the Starknet app is
 * open") — advice that is actively wrong when the wallet itself is the thing
 * that closed the app, and which hides which step actually broke.
 */
import { LedgerRejection } from "@bramble/ledger-protocol/errors";

/**
 * The step a transition is currently on, emitted for progress display only.
 * Presentation never gates the hardware decision on it.
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

/**
 * Ledger's vendor-defined APDU HID usage page. The same physical Ledger can also
 * expose a FIDO collection at 0xF1D0, which cannot carry APDUs.
 */
export const LEDGER_HID_APDU_USAGE_PAGE = 0xffa0;

/**
 * A WebHID device as far as collection selection is concerned. Structural so the
 * pure selection can be exercised without a browser.
 */
export type LedgerHidDevice = {
  // Explicitly admits `undefined`: a granted device whose descriptors the browser
  // has not surfaced reports no collections at all, and that device must still
  // reach the user rather than being typed out of existence.
  readonly collections?: readonly { readonly usagePage?: unknown }[] | undefined;
};

/**
 * Narrows granted WebHID devices to the ones exposing Ledger's APDU collection,
 * so a FIDO collection of the same Ledger is never bound as a transport.
 *
 * Fails OPEN: when no device reports the APDU collection — the descriptors are
 * unavailable, or this firmware/app labels the collection differently — the full
 * list is returned rather than an empty one. Hiding a device the user can
 * physically see is the worse failure: presenting the APDU page as a *picker
 * filter* made a Ledger sitting in the Starknet app invisible while the same
 * device appeared from the dashboard, which reads as broken hardware. Selection
 * is a preference, never a gate; the transport open is the real check.
 */
export const ledgerApduHidDevices = <Device extends LedgerHidDevice>(
  devices: readonly Device[],
): readonly Device[] => {
  const apdu = devices.filter((device) =>
    device.collections?.some((collection) => collection.usagePage === LEDGER_HID_APDU_USAGE_PAGE),
  );
  return apdu.length > 0 ? apdu : devices;
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
const MAX_APP_STATE_TRAILING_FIELDS = 5;

// A reply this build cannot parse. Never carries the raw bytes or any decoded
// device string: the catalog copy is the whole user-facing surface.
const malformedResponse = (): LedgerRejection => new LedgerRejection("management-unreadable");

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
  const statusWord = (byteAt(response, offset) << 8) + byteAt(response, offset + 1);
  if (statusWord !== APDU_OK) {
    throw new LedgerRejection("management-refused", statusWord);
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
  // Flags and anything after them are tolerated the same way the OS envelope
  // tolerates its trailing fields: only the leading name/version are load-bearing
  // here, and firmware is free to append fields this build has never seen.
  // Requiring an exact end-of-envelope once cost the OS parser a hardware-only
  // P1 that every fixture passed — this parser must not repeat it. The count is
  // still bounded, so a garbage reply cannot loop or be read as valid.
  let offset = version.nextOffset;
  let trailingFields = 0;
  while (offset < statusOffset) {
    trailingFields += 1;
    if (trailingFields > MAX_APP_STATE_TRAILING_FIELDS) {
      throw malformedResponse();
    }
    offset = readLv(response, offset, statusOffset, MAX_FLAGS_BYTES).nextOffset;
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
      throw new LedgerRejection("dashboard-restore-failed");
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
      throw new LedgerRejection("starknet-reopen-failed");
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
