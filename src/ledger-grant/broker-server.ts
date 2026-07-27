/**
 * Hardware-owning half of the Ledger grant-window broker. It accepts only the
 * strictly validated protocol from `broker-protocol.ts`, executes one APDU
 * operation at a time against the retained Starknet client, and reduces thrown
 * failures to the fixed Ledger error catalog before responding.
 */
import { type LedgerDeviceClient, ledgerTransportRejection } from "../sidepanel/ledger/client";
import {
  isLedgerBrokerCommand,
  type LedgerBrokerCommand,
  type LedgerBrokerResponse,
} from "./broker-protocol";

/**
 * Narrow BroadcastChannel surface used by the broker, injectable in tests.
 */
export type LedgerBrokerChannel = {
  readonly addEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
  readonly close: () => void;
  readonly postMessage: (message: LedgerBrokerResponse) => void;
  readonly removeEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
};

/**
 * Starts serving validated device commands over one per-session channel. Calls
 * `onClose` exactly once when the panel releases the session; transport teardown
 * remains the grant page's responsibility so UI cancellation and idle expiry
 * share the same close path. The returned function detaches the listener.
 */
export const serveLedgerBroker = (
  channel: LedgerBrokerChannel,
  client: LedgerDeviceClient,
  onClose: () => void,
): (() => void) => {
  let busy = false;
  let closed = false;

  const respond = (response: LedgerBrokerResponse): void => {
    if (!closed) {
      channel.postMessage(response);
    }
  };

  const run = async (
    command: Exclude<LedgerBrokerCommand, { readonly kind: "close" }>,
  ): Promise<void> => {
    if (busy || closed) {
      respond({
        error: "device-busy",
        id: command.id,
        kind: "response",
        ok: false,
      });
      return;
    }
    busy = true;
    try {
      const value =
        command.method === "getAppVersion"
          ? await client.getAppVersion()
          : command.method === "getPubKey"
            ? await client.getPubKey(command.path, false)
            : await client.signHash(command.path, command.hash);
      respond({ id: command.id, kind: "response", ok: true, value });
    } catch (error) {
      respond({
        error: ledgerTransportRejection(error).code,
        id: command.id,
        kind: "response",
        ok: false,
      });
    } finally {
      busy = false;
    }
  };

  const listener = (event: MessageEvent<unknown>): void => {
    if (!isLedgerBrokerCommand(event.data)) {
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
