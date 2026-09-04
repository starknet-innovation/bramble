/**
 * Panel-side half of the Bluetooth broker: opens the device tab, waits for it to
 * report ready, and presents it as an owned {@link PqDeviceSession}.
 *
 * The tab exists because the chooser cannot run in the side panel — measured,
 * see `./protocol` — and because the context that ran the chooser is the only
 * one that can keep the connection: a `BluetoothDevice` cannot be
 * structured-cloned to another realm, and stable Chrome has no
 * `Bluetooth.getDevices()` to recover one later.
 *
 * Every wait is bounded, and the two bounds measure different things. Opening
 * the tab covers a chooser and a handshake; a command covers a person picking up
 * their phone, unlocking it, and approving. Only the first has a sensible
 * default here. See {@link PqSessionRuntime}.
 *
 * The `chrome.tabs` surface is declared locally rather than imported from the
 * Ledger feature. It is the same shape, and that is deliberate duplication: the
 * wallet team owns `ledger-browser` and is expected to change it, so this
 * feature takes no dependency on its types.
 */

import { PqRejection } from "./errors";
import {
  isPqBrokerResponse,
  isPqSignedReply,
  isPqTransportPayload,
  type PqBrokerCommand,
  pqBrokerChannelName,
} from "./protocol";

/**
 * Narrow `chrome.tabs`/`chrome.runtime` surface needed to create, track, and
 * close the device tab. These calls need no `tabs` manifest permission, because
 * no privileged tab metadata is read.
 */
export type PqDeviceBrowser = {
  readonly runtime: {
    readonly getURL: (path: string) => string;
  };
  readonly tabs: {
    readonly create: (options: {
      readonly active: boolean;
      readonly url: string;
    }) => Promise<{ readonly id?: number }>;
    readonly get: (tabId: number) => Promise<{ readonly id?: number }>;
    readonly onRemoved: {
      readonly addListener: (callback: (tabId: number) => void) => void;
      readonly removeListener: (callback: (tabId: number) => void) => void;
    };
    readonly remove: (tabId: number) => Promise<void>;
  };
};

/**
 * An injected bounded wait. Production uses `setTimeout`; tests inject a
 * deterministic scheduler.
 */
export type PqTimeout = {
  readonly ms: number;
  readonly schedule: (onElapsed: () => void, ms: number) => () => void;
};

/**
 * Narrow BroadcastChannel surface used by the panel proxy.
 */
export type PqClientChannel = {
  readonly addEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
  readonly close: () => void;
  readonly postMessage: (message: PqBrokerCommand) => void;
  readonly removeEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
};

/**
 * Browser effects and the two bounds, all injected.
 *
 * `command` has **no default on purpose.** It must be the same value the
 * background sign queue uses (`MOBILE_PQ_SIGN_TIMEOUT` in the extension's
 * `message-context.ts`, currently 900_000 ms), because a transport that gives up
 * while the queue still waits leaves the request parked with the user told it
 * timed out, and the reverse races. Requiring it makes that disagreement
 * impossible to introduce by accident.
 *
 * ponytail: single-source the number itself once the panel wiring lands — the
 * two literals will drift otherwise, which is what this comment is buying time
 * against, not preventing.
 */
export type PqSessionRuntime = {
  readonly channel: (name: string) => PqClientChannel;
  readonly command: PqTimeout;
  readonly ready: PqTimeout;
  readonly sessionId: () => string;
};

/**
 * A live phone session and its mandatory teardown. `close` closes the tab, the
 * channel, and the GATT connection behind it; the caller MUST call it on every
 * outcome or the tab is left open holding the device.
 */
export type PqDeviceSession = {
  readonly close: () => Promise<void>;
  readonly pair: (offer: string) => Promise<string>;
  readonly restore: (offer: string) => Promise<string>;
  readonly restoreKey: (offer: string) => Promise<string>;
  readonly sign: (envelope: string) => Promise<string>;
};

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: Partial<PqDeviceBrowser>;
};

// The command shape before an id is attached. Spelled out rather than derived
// with `Omit`, which does not distribute over a union and collapses to a type
// that accepts neither method's fields.
type PqBrokerCall =
  | { readonly kind: "command"; readonly method: "pair"; readonly offer: string }
  | { readonly kind: "command"; readonly method: "restore"; readonly offer: string }
  | { readonly kind: "command"; readonly method: "restore-key"; readonly offer: string }
  | { readonly envelope: string; readonly kind: "command"; readonly method: "sign" };

type PendingCommand = {
  readonly cancelTimeout: () => void;
  readonly reject: (error: PqRejection) => void;
  readonly resolve: (value: string) => void;
};

const hasBrowserShape = (value: Partial<PqDeviceBrowser> | undefined): value is PqDeviceBrowser =>
  typeof value?.runtime?.getURL === "function" &&
  typeof value?.tabs?.create === "function" &&
  typeof value?.tabs?.get === "function" &&
  typeof value?.tabs?.onRemoved?.addListener === "function" &&
  typeof value?.tabs?.onRemoved?.removeListener === "function" &&
  typeof value?.tabs?.remove === "function";

/**
 * Reads and validates the extension browser surface, or returns null outside a
 * Chromium extension page.
 */
export const pqExtensionBrowser = (): PqDeviceBrowser | null => {
  const chrome = (globalThis as ExtensionGlobal).chrome;
  return hasBrowserShape(chrome) ? chrome : null;
};

/**
 * Page the device tab loads. Its build entrypoint is `src/pq-grant/` in the
 * extension; the session capability travels in the URL fragment.
 */
export const PQ_DEVICE_TAB_PAGE = "pq-grant.html";

const schedule = (onElapsed: () => void, ms: number): (() => void) => {
  const handle = setTimeout(onElapsed, ms);
  return () => clearTimeout(handle);
};

/**
 * The chooser, the connect, and the handshake. A person picking one entry from a
 * list, not a person approving a transaction.
 */
export const PQ_READY_TIMEOUT: PqTimeout = { ms: 120_000, schedule };

/**
 * Opens the device tab and resolves once its broker reports ready. The returned
 * session proxies each device operation to that tab and owns its lifecycle. Closing
 * the tab early rejects with `picker-cancelled` before ready and
 * `panel-context-lost` after, and every wait is bounded, so a lost chooser or a
 * dead context cannot wedge signing.
 */
export const requestPqDeviceSession = async (
  browser: PqDeviceBrowser,
  runtime: PqSessionRuntime,
): Promise<PqDeviceSession> => {
  const sessionId = runtime.sessionId();
  const channel = runtime.channel(pqBrokerChannelName(sessionId));
  const pending = new Map<number, PendingCommand>();
  let requestId = 0;
  let tabId: number | undefined;
  let ready = false;
  let closed = false;
  let rejectReady: ((error: PqRejection) => void) | null = null;
  let resolveReady: (() => void) | null = null;

  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const failPending = (error: PqRejection): void => {
    rejectReady?.(error);
    rejectReady = null;
    resolveReady = null;
    for (const command of pending.values()) {
      command.cancelTimeout();
      command.reject(error);
    }
    pending.clear();
  };

  const detach = (): void => {
    browser.tabs.onRemoved.removeListener(onRemoved);
    channel.removeEventListener("message", onMessage);
  };

  const onRemoved = (removedId: number): void => {
    if (removedId !== tabId || closed) {
      return;
    }
    closed = true;
    detach();
    channel.close();
    failPending(new PqRejection(ready ? "panel-context-lost" : "picker-cancelled"));
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (!isPqBrokerResponse(event.data)) {
      return;
    }
    const response = event.data;
    if (response.kind === "ready") {
      ready = true;
      resolveReady?.();
      rejectReady = null;
      resolveReady = null;
      return;
    }
    const command = pending.get(response.id);
    if (!command) {
      return;
    }
    pending.delete(response.id);
    command.cancelTimeout();
    if (response.ok) {
      command.resolve(response.value);
    } else {
      command.reject(new PqRejection(response.error));
    }
  };

  // Two teardowns, because they happen at different points in the handshake.
  // `discard` runs before anyone awaits `readyPromise`, so rejecting it there
  // would surface as an unhandled rejection rather than as the thrown error the
  // caller is about to see.
  const discard = (): void => {
    closed = true;
    detach();
    channel.close();
  };

  const abandon = (error: PqRejection): void => {
    discard();
    failPending(error);
  };

  channel.addEventListener("message", onMessage);
  browser.tabs.onRemoved.addListener(onRemoved);

  try {
    const created = await browser.tabs.create({
      active: true,
      url: `${browser.runtime.getURL(PQ_DEVICE_TAB_PAGE)}#session=${sessionId}`,
    });
    tabId = created.id;
  } catch {
    discard();
    throw new PqRejection("unexpected-device-error");
  }

  if (tabId === undefined) {
    discard();
    throw new PqRejection("unexpected-device-error");
  }

  // Catch a close that raced tab creation and listener registration.
  void browser.tabs.get(tabId).catch(() => onRemoved(tabId as number));

  const cancelReady = runtime.ready.schedule(() => {
    if (!ready && !closed) {
      abandon(new PqRejection("picker-cancelled"));
      void browser.tabs.remove(tabId as number).catch(() => undefined);
    }
  }, runtime.ready.ms);

  await readyPromise.finally(cancelReady);

  const call = (command: PqBrokerCall) =>
    new Promise<string>((resolve, reject) => {
      if (closed) {
        reject(new PqRejection("panel-context-lost"));
        return;
      }
      requestId += 1;
      const id = requestId;
      const cancelTimeout = runtime.command.schedule(() => {
        const outstanding = pending.get(id);
        if (!outstanding) {
          return;
        }
        pending.delete(id);
        outstanding.reject(new PqRejection("request-timeout"));
      }, runtime.command.ms);
      pending.set(id, { cancelTimeout, reject, resolve });
      channel.postMessage({ ...command, id } as PqBrokerCommand);
    });

  // The reply is validated again here. The tab already checked it, but this side
  // must not trust a value that crossed a channel, and which check applies is
  // decided by the command that was sent — never by inspecting the string, since
  // lowercase hex is itself valid base64url.
  const expect = async (
    command: PqBrokerCall,
    accepts: (reply: unknown) => boolean,
  ): Promise<string> => {
    const reply = await call(command);
    if (!accepts(reply)) {
      throw new PqRejection("malformed-reply");
    }
    return reply;
  };

  return {
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      channel.postMessage({ kind: "close" });
      detach();
      channel.close();
      failPending(new PqRejection("panel-context-lost"));
      await browser.tabs.remove(tabId as number).catch(() => undefined);
    },
    pair: (offer) => expect({ kind: "command", method: "pair", offer }, isPqTransportPayload),
    restore: (offer) => expect({ kind: "command", method: "restore", offer }, isPqTransportPayload),
    restoreKey: (offer) =>
      expect({ kind: "command", method: "restore-key", offer }, isPqTransportPayload),
    sign: (envelope) => expect({ envelope, kind: "command", method: "sign" }, isPqSignedReply),
  };
};
