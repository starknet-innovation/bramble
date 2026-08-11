/**
 * Grant-window-only transport selector. Web Bluetooth and its comparatively
 * large reactive transport stack stay out of the latency-sensitive side-panel
 * bundle; the shared cable boundary supplies WebUSB/WebHID fallbacks.
 */
import { getBluetoothServiceUuids, ledgerUSBVendorId } from "@ledgerhq/devices";
import TransportWebBLE from "@ledgerhq/hw-transport-web-ble";
import {
  bindLedgerTransportRaw,
  requestTransportRaw as requestCableTransport,
} from "./webhid-impl";

const usbSupported = () => typeof navigator.usb?.requestDevice === "function";
const hidSupported = () => typeof navigator.hid?.requestDevice === "function";
const bluetoothSupported = () => typeof navigator.bluetooth?.requestDevice === "function";

export const supportedGrantTransportKinds = () => {
  const kinds = [];
  if (bluetoothSupported()) {
    kinds.push("ble");
  }
  if (usbSupported()) {
    kinds.push("usb");
  }
  if (hidSupported()) {
    kinds.push("hid");
  }
  return kinds;
};

export const requestGrantTransport = (kind) => {
  if (kind !== "ble") {
    return requestCableTransport(kind);
  }
  if (!bluetoothSupported()) {
    const error = new Error("Ledger browser transport unavailable");
    error.name = "TransportNotSupported";
    return Promise.reject(error);
  }
  // Call requestDevice() synchronously from the click handler. Chrome can drop
  // transient user activation across an asynchronous availability preflight,
  // which presents as a picker that never appeared.
  const requestedDevice = navigator.bluetooth.requestDevice({
    filters: getBluetoothServiceUuids().map((uuid) => ({ services: [uuid] })),
  });
  return requestedDevice.then(async (device) =>
    bindLedgerTransportRaw(await TransportWebBLE.open(device), {
      disconnect: () => TransportWebBLE.disconnect(device.id),
      listDevices: async () => [device],
      openDevice: () => TransportWebBLE.open(device),
      selectedDevice: device,
    }),
  );
};

const grantedDeviceCount = async (kind) => {
  try {
    if (kind === "usb" && usbSupported()) {
      const devices = await navigator.usb.getDevices();
      return devices.filter((device) => device.vendorId === ledgerUSBVendorId).length;
    }
    if (kind === "hid" && hidSupported()) {
      const devices = await navigator.hid.getDevices();
      return devices.filter((device) => device.vendorId === ledgerUSBVendorId).length;
    }
  } catch {
    return 0;
  }
  return null;
};

export const readGrantTransportDiagnostics = async (kind) => {
  const apiAvailable =
    kind === "usb" ? usbSupported() : kind === "hid" ? hidSupported() : bluetoothSupported();
  return {
    apiAvailable,
    grantedDeviceCount: await grantedDeviceCount(kind),
  };
};

export const closeGrantTransport = async (transport) => {
  let closeError;
  try {
    await transport.close();
  } catch (error) {
    closeError = error;
  }
  if (closeError !== undefined) {
    throw closeError;
  }
};
