/**
 * The Web Bluetooth half of the transport: the only place a live phone is
 * opened. It must run in a Window context that owns a user gesture — see
 * `./protocol` for why that is a tab and not the side panel.
 *
 * Web Bluetooth is central-only, so the browser cannot advertise and the phone
 * is the GATT peripheral. This side writes a framed request to
 * {@link PQ_REQUEST_UUID} and reassembles the reply from notifications on
 * {@link PQ_RESPONSE_UUID}, sized by an MTU only the phone can see.
 *
 * The types are declared locally because TypeScript's DOM library does not ship
 * Web Bluetooth, and only the members this file actually uses are declared —
 * a narrow surface is easier to audit than a vendored one, and there is nothing
 * else on `navigator.bluetooth` this transport needs.
 *
 * Device I/O cannot be exercised without a phone and Chromium, so this module is
 * deliberately thin: the framing it drives is pure and tested in `./framing`,
 * the decisions above it are tested in `./broker-server`, and what remains here
 * is the sequence of GATT calls.
 */

import type { PqDevice } from "./broker-server";
import { PqRejection, pqRefusalCode } from "./errors";
import {
  chunkForWrite,
  createPqReassembler,
  framePayload,
  PQ_REQUEST_UUID,
  PQ_RESPONSE_UUID,
  PQ_SERVICE_UUID,
  type PqFrameTag,
} from "./framing";

/**
 * The subset of Web Bluetooth this transport uses. Structural, so a test can
 * supply a fake with no radio.
 */
export type PqBluetoothCharacteristic = {
  readonly addEventListener: (type: "characteristicvaluechanged", listener: () => void) => void;
  readonly startNotifications: () => Promise<unknown>;
  readonly value?: { readonly buffer: ArrayBufferLike; readonly byteLength: number } | undefined;
  readonly writeValue?: (value: BufferSource) => Promise<void>;
  readonly writeValueWithResponse?: (value: BufferSource) => Promise<void>;
};

/**
 * A connected phone, as this transport uses it.
 */
export type PqBluetoothDevice = {
  readonly addEventListener: (type: "gattserverdisconnected", listener: () => void) => void;
  readonly gatt?: {
    readonly connect: () => Promise<{
      readonly getPrimaryService: (uuid: string) => Promise<{
        readonly getCharacteristic: (uuid: string) => Promise<PqBluetoothCharacteristic>;
      }>;
    }>;
    readonly disconnect: () => void;
  };
  readonly name?: string | undefined;
};

type ChooserNavigator = {
  readonly bluetooth?: {
    readonly requestDevice: (options: {
      readonly filters: readonly { readonly services: readonly string[] }[];
    }) => Promise<PqBluetoothDevice>;
  };
};

/**
 * True when this runtime exposes Web Bluetooth at all. Capability detection, not
 * a permission check: the chooser still needs a user gesture, and Brave exposes
 * the API while blocking discovery unless its Bluetooth flag is enabled.
 */
export const isPqBluetoothAvailable = (): boolean =>
  typeof navigator !== "undefined" &&
  typeof (navigator as ChooserNavigator).bluetooth?.requestDevice === "function";

/**
 * Opens Chrome's device chooser, filtered to the signer service.
 *
 * MUST be called synchronously from the click handler. Chrome drops transient
 * activation across an `await`, and the symptom is a chooser that never appears
 * rather than an error — so this function performs no preflight of its own and
 * returns the chooser's promise directly.
 */
export const requestPqDevice = (): Promise<PqBluetoothDevice> => {
  const bluetooth = (navigator as ChooserNavigator).bluetooth;
  if (!bluetooth) {
    return Promise.reject(new PqRejection("bluetooth-unavailable"));
  }
  return bluetooth.requestDevice({ filters: [{ services: [PQ_SERVICE_UUID] }] });
};

/**
 * One tagged reply, as the phone sent it.
 */
export type PqReply = {
  readonly payload: string;
  readonly tag: PqFrameTag;
};

/**
 * A live connection: one tagged request in, one tagged reply out, until closed.
 */
export type PqConnection = {
  readonly close: () => void;
  readonly exchange: (
    tag: "pair" | "sign" | "restore" | "restore-key",
    payload: string,
  ) => Promise<PqReply>;
};

const writeChunk = async (
  characteristic: PqBluetoothCharacteristic,
  chunk: Uint8Array,
): Promise<void> => {
  // `writeValueWithResponse` is the current spelling; `writeValue` is the
  // deprecated one still present in older Chromium. Acknowledged writes rather
  // than fire-and-forget: without them a multi-kilobyte request can outrun the
  // phone's buffer and lose a chunk with no error anywhere.
  const write = characteristic.writeValueWithResponse ?? characteristic.writeValue;
  if (!write) {
    throw new PqRejection("device-unreachable");
  }
  await write.call(characteristic, chunk as BufferSource);
};

/**
 * Connects to a chosen phone and resolves once its service is ready to use.
 *
 * The reply is reassembled by length prefix from notifications, so the phone is
 * free to chunk however its MTU allows. A disconnect mid-exchange settles the
 * outstanding request as `device-lost` rather than leaving it pending — a signing
 * request that never settles is a wallet that tells the user nothing.
 */
export const connectPqDevice = async (device: PqBluetoothDevice): Promise<PqConnection> => {
  const gatt = device.gatt;
  if (!gatt) {
    throw new PqRejection("device-unreachable");
  }

  let lost = false;
  let onLost: (() => void) | null = null;
  device.addEventListener("gattserverdisconnected", () => {
    lost = true;
    onLost?.();
  });

  const server = await gatt.connect().catch(() => {
    throw new PqRejection("device-unreachable");
  });
  const service = await server.getPrimaryService(PQ_SERVICE_UUID).catch(() => {
    // Connected, but not the service we filtered for: a different build of the
    // app, or a protocol version this wallet does not speak.
    throw new PqRejection("protocol-mismatch");
  });
  const request = await service.getCharacteristic(PQ_REQUEST_UUID).catch(() => {
    throw new PqRejection("protocol-mismatch");
  });
  const response = await service.getCharacteristic(PQ_RESPONSE_UUID).catch(() => {
    throw new PqRejection("protocol-mismatch");
  });

  let deliver: ((chunk: Uint8Array) => void) | null = null;
  response.addEventListener("characteristicvaluechanged", () => {
    const value = response.value;
    if (value) {
      deliver?.(new Uint8Array(value.buffer.slice(0, value.byteLength)));
    }
  });
  await response.startNotifications().catch(() => {
    throw new PqRejection("protocol-mismatch");
  });

  return {
    close: () => {
      deliver = null;
      onLost = null;
      gatt.disconnect();
    },
    exchange: async (tag, payload) => {
      if (lost) {
        throw new PqRejection("device-lost");
      }
      const framed = framePayload(tag, payload);
      const reassembler = createPqReassembler();
      const reply = new Promise<PqReply>((resolve, reject) => {
        onLost = () => reject(new PqRejection("device-lost"));
        deliver = (chunk) => {
          const frame = reassembler.push(chunk);
          if (frame.kind === "complete") {
            resolve({ payload: frame.payload, tag: frame.tag });
          } else if (frame.kind === "invalid") {
            reject(new PqRejection("malformed-reply"));
          }
        };
      });

      // Subscribed before the first byte goes out: a phone that answers between
      // the last write and the listener being attached would drop the reply.
      for (const chunk of chunkForWrite(framed)) {
        await writeChunk(request, chunk);
      }
      try {
        return await reply;
      } finally {
        deliver = null;
        onLost = null;
      }
    },
  };
};

// A phone that answers a `sign` with a pairing reply is broken, not merely
// unlucky, so a tag that does not belong to the request is refused rather than
// unwrapped. `refused` is the one alternative every request may legitimately
// receive, and the reason the phone names becomes the code the user is shown.
const unwrap = (expected: PqFrameTag, reply: PqReply): string => {
  if (reply.tag === expected) {
    return reply.payload;
  }
  if (reply.tag === "refused") {
    throw new PqRejection(pqRefusalCode(reply.payload));
  }
  throw new PqRejection("malformed-reply");
};

/**
 * Presents a live connection as the two operations the broker serves.
 *
 * This is where a refusal stops being a transport event and becomes a rejection
 * the user can act on: the phone says `declined` or `wrong-network`, and that
 * arrives at the panel as its own message rather than as a malformed reply.
 */
export const pqDeviceFrom = (connection: PqConnection): PqDevice => ({
  pair: async (offer) => unwrap("paired", await connection.exchange("pair", offer)),
  restore: async (offer) => unwrap("restored", await connection.exchange("restore", offer)),
  restoreKey: async (offer) =>
    unwrap("restored-key", await connection.exchange("restore-key", offer)),
  sign: async (envelope) => unwrap("signed", await connection.exchange("sign", envelope)),
});
