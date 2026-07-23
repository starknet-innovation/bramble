/**
 * Runtime-only WebHID boundary: the single place the concrete
 * `@ledgerhq/hw-transport-webhid` transport and `@ledgerhq/hw-app-starknet`
 * client are imported. It is a plain `.js` module (not covered by the pinned
 * `tsconfig` `include`, which is `*.ts` only) precisely so the vendored Ledger
 * `.d.ts` files are never pulled into the type-checked program: those bundled
 * declarations do not compile under this repo's pinned `skipLibCheck: false` and
 * `types: ["bun-types"]`. All typed logic (error mapping, availability gating,
 * device APDU handling) lives in the sibling `.ts` modules and consumes these
 * exports through the hand-written `webhid-impl.d.ts` surface. Bun bundles this
 * file into the side panel at build time; tsc ignores it.
 *
 * The only state kept here maps origin-granted `HIDDevice` objects to opaque,
 * side-panel-local chooser ids so a multi-device selection opens the exact
 * object the user chose. No id is persisted or sent across an extension
 * message boundary. Every transport failure propagates to `transport.ts`,
 * which maps it to a typed `LedgerRejection` (fail closed).
 */
import { StarknetClient } from "@ledgerhq/hw-app-starknet";
import TransportWebHID from "@ledgerhq/hw-transport-webhid";

const deviceIds = new WeakMap();
const knownDevices = new Map();
let nextDeviceId = 0;

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

const connectedDevices = async () => {
  const devices = await TransportWebHID.list();
  const baseLabels = devices.map((device) => device.productName || "Ledger");
  const totals = new Map();
  for (const label of baseLabels) {
    totals.set(label, (totals.get(label) || 0) + 1);
  }
  const seen = new Map();
  return devices.map((device, index) => {
    const base = baseLabels[index];
    const ordinal = (seen.get(base) || 0) + 1;
    seen.set(base, ordinal);
    const id = idOf(device);
    knownDevices.set(id, device);
    return {
      device,
      id,
      label: totals.get(base) > 1 ? `${base} ${ordinal}` : base,
    };
  });
};

export const listConnectedDevicesRaw = async () =>
  (await connectedDevices()).map(({ id, label }) => ({ id, label }));

export const openConnectedTransportRaw = async (deviceId) => {
  if (deviceId === undefined) {
    return TransportWebHID.openConnected();
  }
  const selected = knownDevices.get(deviceId);
  return selected ? TransportWebHID.open(selected) : null;
};

export const newStarknetClient = (transport) => new StarknetClient(transport);
