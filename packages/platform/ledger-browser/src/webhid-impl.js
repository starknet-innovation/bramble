/**
 * Runtime-only browser cable-transport boundary. WebUSB handles active apps
 * that expose a vendor USB interface; WebHID is constrained to Ledger's
 * vendor-defined APDU usage page for devices Chrome permits. The grant-only
 * Web Bluetooth dependency lives in `ledger-grant/grant-transport.js`, keeping
 * its reactive stack out of the latency-sensitive side-panel bundle.
 *
 * Origin-granted browser device objects are mapped to opaque, page-local ids.
 * No serial number, account, or key material is persisted or crosses an
 * extension-message boundary. Transport errors propagate to the typed boundary
 * and are reduced to the fixed Ledger rejection catalog.
 */

import {
  exactLedgerDevice,
  ledgerApduHidDevices,
  readLedgerOsAndRestoreStarknet,
} from "@bramble/ledger-protocol/device-transition";
import { ledgerUSBVendorId } from "@ledgerhq/devices";
import { StarknetClient } from "@ledgerhq/hw-app-starknet";
import TransportWebHID from "@ledgerhq/hw-transport-webhid";
import TransportWebUSB from "@ledgerhq/hw-transport-webusb";
import { Buffer } from "buffer";

const deviceIds = new WeakMap();
const knownDevices = new Map();
let nextDeviceId = 0;

// Ledger's APDU HID collection (vendor-defined usage page 0xFFA0) is PREFERRED
// when selecting among granted devices, never used to filter the chooser: see
// `ledgerApduHidDevices`. A Ledger sitting in the Starknet app would otherwise
// not appear in the picker at all.

const transports = {
  hid: TransportWebHID,
  usb: TransportWebUSB,
};

const reconnectAttempts = 40;
const reconnectDelayMs = 250;
const boundTransports = new WeakMap();

const sessionUnavailable = (state) => !state || state.closed || state.reconnecting;
const sessionEnded = (state, generation) => state.closed || state.generation !== generation;

const pause = () => new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));

const closeQuietly = async (transport) => {
  try {
    await transport.close();
  } catch {
    // A transition deliberately invalidates this transport. The exact-device
    // reopen and post-transition state check are the authoritative result.
  }
};

const reopenExactDevice = async (state, generation) => {
  const candidates = await state.binding.listDevices();
  const selected = exactLedgerDevice(state.binding.selectedDevice, candidates);
  if (!selected) {
    return null;
  }
  const reopened = await state.binding.openDevice(selected);
  if (sessionEnded(state, generation)) {
    await closeQuietly(reopened);
    return null;
  }
  return reopened;
};

const reconnectBoundTransport = async (transport) => {
  const state = boundTransports.get(transport);
  if (sessionUnavailable(state)) {
    throw new Error("Ledger exact-device session is unavailable");
  }
  state.reconnecting = true;
  const generation = state.generation;
  const previous = state.current;
  state.current = null;
  await closeQuietly(previous);

  let lastError;
  try {
    for (let attempt = 0; attempt < reconnectAttempts; attempt += 1) {
      if (sessionEnded(state, generation)) {
        break;
      }
      try {
        const reopened = await reopenExactDevice(state, generation);
        if (reopened) {
          state.current = reopened;
          return;
        }
      } catch (error) {
        lastError = error;
      }
      if (attempt + 1 < reconnectAttempts) {
        await pause();
      }
    }
  } finally {
    state.reconnecting = false;
  }
  const error = new Error("Ledger disconnected before the exact device could reconnect");
  error.name = "DisconnectedDevice";
  if (lastError !== undefined) {
    error.cause = lastError;
  }
  throw error;
};

const operationFailure = async (operation) => {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error;
  }
};

const closeTransportResources = async (binding, current) => {
  const disconnectError = await operationFailure(() => binding.disconnect?.());
  const closeError = current ? await operationFailure(() => current.close()) : undefined;
  const error = disconnectError ?? closeError;
  if (error !== undefined) {
    throw error;
  }
};

/**
 * Wraps a selected browser transport with an exact-device reconnection binding.
 * Only the original browser object, its unique origin-scoped id, or its unique
 * vendor-bound serial may be reopened; list order and product labels are never
 * accepted as identity.
 */
export const bindLedgerTransportRaw = (initial, binding) => {
  const state = { binding, closed: false, current: initial, generation: 0, reconnecting: false };
  const transport = {
    close: async () => {
      if (state.closed) {
        return;
      }
      state.closed = true;
      state.generation += 1;
      const current = state.current;
      state.current = null;
      await closeTransportResources(binding, current);
    },
    send: (...args) => {
      if (!state.current || state.closed) {
        throw new Error("Ledger exact-device session is unavailable");
      }
      return state.current.send(...args);
    },
  };
  boundTransports.set(transport, state);
  return transport;
};

const bindCableTransport = async (kind, device) =>
  bindLedgerTransportRaw(await transports[kind].open(device), {
    listDevices: () => transports[kind].list(),
    openDevice: (selected) => transports[kind].open(selected),
    selectedDevice: device,
  });

const idOf = (device) => {
  const known = deviceIds.get(device);
  if (known) {
    return known;
  }
  nextDeviceId += 1;
  const id = `ledger-device-${nextDeviceId}`;
  deviceIds.set(device, id);
  return id;
};

const isSupported = async (kind) => {
  try {
    return await transports[kind].isSupported();
  } catch {
    return false;
  }
};

const listedDevices = async (kind) => {
  if (!(await isSupported(kind))) {
    return [];
  }
  try {
    const listed = await transports[kind].list();
    // Ledger's transport lists by vendor id alone, so one physical Ledger can
    // arrive as several collections. Preferring the APDU collection keeps a
    // single device from reading as two and from binding its FIDO collection.
    return kind === "hid" ? ledgerApduHidDevices(listed) : listed;
  } catch {
    return [];
  }
};

// Use one granted transport family at a time, avoiding duplicate rows when the
// same physical Ledger has both Bluetooth and cable grants.
const connectedDevices = async () => {
  let kind;
  let devices = [];
  for (const candidate of ["usb", "hid"]) {
    const listed = await listedDevices(candidate);
    if (listed.length > 0) {
      kind = candidate;
      devices = listed;
      break;
    }
  }
  if (!kind) {
    knownDevices.clear();
    return [];
  }
  const baseLabels = devices.map((device) => device.productName || device.name || "Ledger");
  const totals = new Map();
  knownDevices.clear();
  for (const label of baseLabels) {
    totals.set(label, (totals.get(label) || 0) + 1);
  }
  const seen = new Map();
  return devices.map((device, index) => {
    const base = baseLabels[index];
    const ordinal = (seen.get(base) || 0) + 1;
    seen.set(base, ordinal);
    const id = idOf(device);
    knownDevices.set(id, { device, kind });
    return {
      device,
      id,
      kind,
      label: totals.get(base) > 1 ? `${base} ${ordinal}` : base,
    };
  });
};

export const listConnectedDevicesRaw = async () =>
  (await connectedDevices()).map(({ id, label }) => ({ id, label }));

export const openConnectedTransportRaw = async (deviceId) => {
  if (deviceId !== undefined) {
    const selected = knownDevices.get(deviceId);
    return selected ? bindCableTransport(selected.kind, selected.device) : null;
  }
  const [connected] = await connectedDevices();
  return connected ? bindCableTransport(connected.kind, connected.device) : null;
};

export const supportedTransportKindsRaw = async () => {
  const kinds = [];
  if (await isSupported("usb")) {
    kinds.push("usb");
  }
  if (await isSupported("hid")) {
    kinds.push("hid");
  }
  return kinds;
};

export const requestTransportRaw = async (kind) => {
  const apiAvailable =
    kind === "usb"
      ? typeof navigator.usb?.requestDevice === "function"
      : kind === "hid"
        ? typeof navigator.hid?.requestDevice === "function"
        : false;
  if (!(kind in transports) || !apiAvailable) {
    const error = new Error("Ledger browser transport unavailable");
    error.name = "TransportNotSupported";
    throw error;
  }
  if (kind === "hid") {
    // Invoke the chooser before crossing an asynchronous boundary. Chrome
    // requires requestDevice() to consume the transient activation from the
    // Connect click; even an innocent capability preflight can otherwise make
    // the picker disappear without presenting a device list.
    // Vendor id only, matching Ledger's own WebHID transport. Adding the APDU
    // usage page here hid a Ledger that had the Starknet app open — the very
    // state the wallet asks the user to be in — while the same device showed up
    // from the dashboard. The APDU collection is preferred below, after the
    // picker has already shown every Ledger the user can physically see.
    const requestedDevices = navigator.hid.requestDevice({
      filters: [{ vendorId: ledgerUSBVendorId }],
    });
    // Chrome can return one entry per top-level collection for a single physical
    // Ledger, so the first entry is not necessarily the APDU one.
    const [device] = ledgerApduHidDevices(await requestedDevices);
    if (!device) {
      throw new DOMException("No Ledger selected", "NotFoundError");
    }
    return bindCableTransport("hid", device);
  }
  // Target the vendor transport interface rather than the composite device as
  // a whole. Modern Ledgers can expose Ledger APDU, vendor USB, and protected
  // FIDO interfaces under one product; the vendor interface is the only one
  // WebUSB is permitted to claim.
  const requestedDevice = navigator.usb.requestDevice({
    filters: [{ classCode: 0xff, vendorId: ledgerUSBVendorId }],
  });
  const device = await requestedDevice;
  return bindCableTransport("usb", device);
};

export const newStarknetClient = (transport, onTransition) => {
  const client = new StarknetClient(transport);
  client.getOsVersion = () =>
    readLedgerOsAndRestoreStarknet(
      {
        reconnect: () => reconnectBoundTransport(transport),
        send: (cla, ins, p1, p2, data, statuses) =>
          transport.send(cla, ins, p1, p2, Buffer.from(data), statuses),
      },
      onTransition,
    );
  return client;
};
