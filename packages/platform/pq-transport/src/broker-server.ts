/**
 * Device-owning half of the Bluetooth broker: the code that runs inside the
 * dedicated tab, next to the live GATT connection.
 *
 * It accepts only the strictly validated protocol from `./protocol`, runs one
 * operation at a time against the connected phone, and reduces every thrown
 * failure to the fixed catalog in `./errors` before answering. It also validates
 * what the phone sent BEFORE that value crosses the channel — the tab is the
 * only context that saw those bytes, so it is the right place to refuse a reply
 * that is the wrong shape, and the panel validates again on arrival.
 *
 * The GATT connection is injected as {@link PqDevice}, so every decision here is
 * exercised with a fake and only the two methods behind that seam need hardware.
 */

import { PqRejection, type PqRejectionCode } from "./errors";
import {
  isPqBrokerCommand,
  isPqSignedReply,
  isPqTransportPayload,
  type PqBrokerCommand,
  type PqBrokerResponse,
} from "./protocol";

/**
 * The connected phone, as this broker needs it: two operations over strings the
 * panel already built, and nothing else. Both may reject; a rejection that is
 * not a {@link PqRejection} is reported as `unexpected-device-error`, so a raw
 * GATT or DOM error never leaves this context.
 */
export type PqDevice = {
  readonly pair: (offer: string) => Promise<string>;
  readonly restore: (offer: string) => Promise<string>;
  readonly restoreKey: (offer: string) => Promise<string>;
  readonly sign: (envelope: string) => Promise<string>;
};

/**
 * Narrow BroadcastChannel surface used by the broker, injectable in tests.
 */
export type PqBrokerChannel = {
  readonly addEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
  readonly close: () => void;
  readonly postMessage: (message: PqBrokerResponse) => void;
  readonly removeEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
};

type DeviceCommand = Exclude<PqBrokerCommand, { readonly kind: "close" }>;

const runCommand = (device: PqDevice, command: DeviceCommand): Promise<string> => {
  switch (command.method) {
    case "pair":
      return device.pair(command.offer);
    case "restore":
      return device.restore(command.offer);
    case "restore-key":
      return device.restoreKey(command.offer);
    default:
      return device.sign(command.envelope);
  }
};

// Which shape the phone's reply must have depends on the command it answers, and
// never on the string itself: lowercase hex is valid base64url, so sniffing
// would accept a signing reply as a pairing reply. See `./protocol`.
//
// Only `sign` answers in hex. Both restore replies are base64url JSON, as a
// pairing reply is — the per-account one is byte for byte a pairing reply, which
// is what lets the panel decode it with the decoder it already has.
const isExpectedReply = (command: DeviceCommand, reply: unknown): boolean =>
  command.method === "sign" ? isPqSignedReply(reply) : isPqTransportPayload(reply);

const rejectionCode = (error: unknown): PqRejectionCode =>
  error instanceof PqRejection ? error.code : "unexpected-device-error";

/**
 * Starts serving validated panel commands over one per-session channel. Posts
 * `ready` immediately, so the panel resolves only once this side is listening.
 * Calls `onClose` exactly once when the panel releases the session; tearing the
 * GATT connection down stays the tab's own responsibility, so cancellation and
 * expiry share one close path. The returned function detaches the listener.
 */
export const servePqBroker = (
  channel: PqBrokerChannel,
  device: PqDevice,
  onClose: () => void,
): (() => void) => {
  let busy = false;
  let closed = false;

  const respond = (response: PqBrokerResponse): void => {
    if (!closed) {
      channel.postMessage(response);
    }
  };

  const fail = (id: number, error: PqRejectionCode): void => {
    respond({ error, id, kind: "response", ok: false });
  };

  const run = async (command: DeviceCommand): Promise<void> => {
    if (busy || closed) {
      // One at a time: a GATT connection is a serial pipe, and the phone shows
      // one request at a time. Refused rather than queued, because the panel is
      // already single-flight and a queue here would hide a caller's bug.
      fail(command.id, "device-busy");
      return;
    }
    busy = true;
    try {
      const reply = await runCommand(device, command);
      if (!isExpectedReply(command, reply)) {
        fail(command.id, "malformed-reply");
        return;
      }
      respond({ id: command.id, kind: "response", ok: true, value: reply });
    } catch (error) {
      fail(command.id, rejectionCode(error));
    } finally {
      busy = false;
    }
  };

  const listener = (event: MessageEvent<unknown>): void => {
    if (!isPqBrokerCommand(event.data)) {
      return;
    }
    if (event.data.kind === "close") {
      if (!closed) {
        closed = true;
        channel.removeEventListener("message", listener);
        onClose();
      }
      return;
    }
    void run(event.data);
  };

  channel.addEventListener("message", listener);
  channel.postMessage({ kind: "ready" });
  return () => {
    closed = true;
    channel.removeEventListener("message", listener);
  };
};
