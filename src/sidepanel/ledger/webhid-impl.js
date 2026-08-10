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
import { Buffer } from "buffer";

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

// Ledger's built-in Get OS Version command is accepted only on the dashboard,
// while the Starknet APDUs require the Starknet app. Use the existing transport
// to make that transition atomically: quit the active app, read the OS, then
// open Starknet again. Opening a second transport would race the device pipe.
// The version response ends in the APDU status word and starts with a u32 target
// id followed by the length-prefixed secure-element version string.
const OS_VERSION_APDU = { cla: 0xe0, ins: 0x01, p1: 0, p2: 0 };
const QUIT_APP_APDU = { cla: 0xb0, ins: 0xa7, p1: 0, p2: 0 };
const OPEN_APP_APDU = { cla: 0xe0, ins: 0xd8, p1: 0, p2: 0 };
const APDU_OK = 0x9000;
const STARKNET_APP_NAME = "Starknet";

const sendEmptyApdu = (transport, apdu) =>
  transport.send(apdu.cla, apdu.ins, apdu.p1, apdu.p2, Buffer.alloc(0), [APDU_OK]);

const malformedOsVersion = () => new Error("Malformed Ledger OS version response");

const parseOsVersion = (response) => {
  if (!(response instanceof Uint8Array) || response.length < 8) {
    throw malformedOsVersion();
  }
  const statusOffset = response.length - 2;
  const status = (response[statusOffset] << 8) | response[statusOffset + 1];
  if (status !== APDU_OK) {
    throw new Error("Ledger OS version command failed");
  }
  const targetId =
    response[0] * 0x1000000 + response[1] * 0x10000 + response[2] * 0x100 + response[3];
  const versionLength = response[4];
  const versionEnd = 5 + versionLength;
  // Ledger's response always includes a length-prefixed flags field after the
  // secure-element version. Validate that envelope even though this wallet does
  // not consume the flags; otherwise a truncated APDU could be accepted as a
  // valid firmware response.
  if (versionLength === 0 || versionEnd >= statusOffset) {
    throw malformedOsVersion();
  }
  const flagsLength = response[versionEnd];
  if (versionEnd + 1 + flagsLength > statusOffset) {
    throw malformedOsVersion();
  }
  return {
    targetId,
    version: new TextDecoder("utf-8", { fatal: true }).decode(response.slice(5, versionEnd)),
  };
};

const openStarknet = (transport) =>
  transport.send(
    OPEN_APP_APDU.cla,
    OPEN_APP_APDU.ins,
    OPEN_APP_APDU.p1,
    OPEN_APP_APDU.p2,
    Buffer.from(STARKNET_APP_NAME, "ascii"),
    [APDU_OK],
  );

const readOsVersion = async (transport) => {
  // This flow may start in Starknet or on the dashboard. Keep the transition on
  // one owned transport so a second browser connection cannot race the APDU
  // pipe; model/transport reconnection behavior is covered by the mandatory
  // physical compatibility matrix rather than assumed from this pure client.
  await sendEmptyApdu(transport, QUIT_APP_APDU);
  let osVersion;
  let readError;
  try {
    const response = await transport.send(
      OS_VERSION_APDU.cla,
      OS_VERSION_APDU.ins,
      OS_VERSION_APDU.p1,
      OS_VERSION_APDU.p2,
      Buffer.alloc(0),
      [APDU_OK],
    );
    osVersion = parseOsVersion(response);
  } catch (error) {
    readError = error;
  }

  // Once the quit APDU succeeds, best-effort restoration keeps a malformed or
  // failed OS read from stranding the user on the dashboard. Preserve the OS
  // failure when both operations fail because it is the cause of this check.
  try {
    await openStarknet(transport);
  } catch (error) {
    if (readError === undefined) {
      throw error;
    }
  }
  if (readError !== undefined) {
    throw readError;
  }
  if (!osVersion) {
    throw malformedOsVersion();
  }
  return osVersion;
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

export const newStarknetClient = (transport) => {
  const client = new StarknetClient(transport);
  client.getOsVersion = () => readOsVersion(transport);
  return client;
};
