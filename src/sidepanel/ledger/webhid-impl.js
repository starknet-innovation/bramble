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

import { ledgerUSBVendorId } from "@ledgerhq/devices";
import { StarknetClient } from "@ledgerhq/hw-app-starknet";
import TransportWebHID from "@ledgerhq/hw-transport-webhid";
import TransportWebUSB from "@ledgerhq/hw-transport-webusb";

const deviceIds = new WeakMap();
const knownDevices = new Map();
let nextDeviceId = 0;

// Ledger's APDU HID collection is vendor-defined usage page 0xFFA0. This
// deliberately excludes the same Nano's FIDO collection at 0xF1D0.
const ledgerHidUsagePage = 0xffa0;

const transports = {
  hid: TransportWebHID,
  usb: TransportWebUSB,
};

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
    return await transports[kind].list();
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
    return selected ? transports[selected.kind].open(selected.device) : null;
  }
  const [connected] = await connectedDevices();
  return connected ? transports[connected.kind].open(connected.device) : null;
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
    const requestedDevices = navigator.hid.requestDevice({
      filters: [{ vendorId: ledgerUSBVendorId, usagePage: ledgerHidUsagePage }],
    });
    const [device] = await requestedDevices;
    if (!device) {
      throw new DOMException("No Ledger selected", "NotFoundError");
    }
    return TransportWebHID.open(device);
  }
  // Target the vendor transport interface rather than the composite device as
  // a whole. Modern Ledgers can expose Ledger APDU, vendor USB, and protected
  // FIDO interfaces under one product; the vendor interface is the only one
  // WebUSB is permitted to claim.
  const requestedDevice = navigator.usb.requestDevice({
    filters: [{ classCode: 0xff, vendorId: ledgerUSBVendorId }],
  });
  const device = await requestedDevice;
  return TransportWebUSB.open(device);
};

export const newStarknetClient = (transport) => new StarknetClient(transport);
