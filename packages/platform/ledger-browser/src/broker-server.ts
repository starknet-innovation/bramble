/**
 * Hardware-owning half of the Ledger grant-tab broker. It accepts only the
 * strictly validated protocol from `broker-protocol.ts`, executes one APDU
 * operation at a time against the retained Starknet client, and reduces thrown
 * failures to the fixed Ledger error catalog before responding.
 */

import {
  isLedgerBrokerCommand,
  type LedgerBrokerCommand,
  type LedgerBrokerResponse,
} from "@bramble/ledger-protocol/broker";
import { type LedgerDeviceClient, ledgerTransportRejection } from "@bramble/ledger-protocol/client";

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
 * Idle bound on a served session: when no command arrives for `ms`, the
 * session closes through the same `onClose` path as an explicit release.
 * Production uses `setTimeout`; tests inject a deterministic scheduler.
 */
export type LedgerBrokerIdleExpiry = {
  readonly ms: number;
  readonly schedule: (onElapsed: () => void, ms: number) => () => void;
};

/**
 * How long a grant tab keeps the device claimed with no command from the panel.
 * The panel normally sends `close` when it is done; this bound covers an owner
 * that died without sending it, such as a toolbar popup that closed when the
 * grant tab took focus (Sherlock 227). Device confirmation runs inside one
 * command, so a user reading the device screen never trips it.
 */
export const LEDGER_BROKER_IDLE_MS = 5 * 60_000;

const LEDGER_BROKER_IDLE_EXPIRY: LedgerBrokerIdleExpiry = {
  ms: LEDGER_BROKER_IDLE_MS,
  schedule: (onElapsed, ms) => {
    const handle = setTimeout(onElapsed, ms);
    return () => clearTimeout(handle);
  },
};

const executeLedgerCommand = (
  client: LedgerDeviceClient,
  command: Exclude<LedgerBrokerCommand, { readonly kind: "close" }>,
): Promise<unknown> => {
  switch (command.method) {
    case "getOsVersion":
      return client.getOsVersion();
    case "getAppVersion":
      return client.getAppVersion();
    case "getPubKey":
      return client.getPubKey(command.path, false);
    case "signHash":
      return client.signHash(command.path, command.hash);
  }
};

/**
 * Starts serving validated device commands over one per-session channel. Calls
 * `onClose` exactly once when the panel releases the session or the session
 * sits idle past `idle.ms` with no command in flight; transport teardown
 * remains the grant page's responsibility so UI cancellation and idle expiry
 * share the same close path. The returned function detaches the listener.
 */
export const serveLedgerBroker = (
  channel: LedgerBrokerChannel,
  client: LedgerDeviceClient,
  onClose: () => void,
  idle: LedgerBrokerIdleExpiry = LEDGER_BROKER_IDLE_EXPIRY,
): (() => void) => {
  let busy = false;
  let closed = false;
  let cancelIdle: () => void = () => undefined;

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    cancelIdle();
    channel.removeEventListener("message", listener);
    onClose();
  };

  const armIdle = (): void => {
    cancelIdle();
    // Disarmed while a command runs (see `run`), so expiry never cuts off a
    // device confirmation in progress.
    cancelIdle = idle.schedule(close, idle.ms);
  };

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
    cancelIdle();
    try {
      const value = await executeLedgerCommand(client, command);
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
      if (!closed) {
        armIdle();
      }
    }
  };

  const listener = (event: MessageEvent<unknown>): void => {
    if (!isLedgerBrokerCommand(event.data)) {
      return;
    }
    if (event.data.kind === "close") {
      close();
      return;
    }
    void run(event.data);
  };

  channel.addEventListener("message", listener);
  channel.postMessage({ kind: "ready" });
  armIdle();
  return () => {
    closed = true;
    cancelIdle();
    channel.removeEventListener("message", listener);
  };
};
