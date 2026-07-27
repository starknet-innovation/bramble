/**
 * Top-level Ledger hardware-window boundary. Chrome suppresses a composite Nano
 * X from WebHID when any interface exposes FIDO, while stable Web Bluetooth
 * does not expose `Bluetooth.getDevices()` for a later silent reopen. The
 * gesture-owning popup therefore retains the live transport for the current
 * read/sign operation and this module presents it as an owned
 * {@link LedgerDeviceSession} to the side panel.
 *
 * Communication uses a per-window, random-capability BroadcastChannel scoped
 * to this extension origin. Both ends validate every message; only canonical
 * Ledger paths, Stark hashes, public app/key responses, and raw signatures can
 * cross it. Private keys and device identifiers never do.
 */
import {
  isLedgerBrokerResponse,
  type LedgerBrokerCommand,
  type LedgerBrokerResponse,
  ledgerBrokerChannelName,
} from "../../ledger-grant/broker-protocol";
import { LedgerRejection } from "./errors";
import type { LedgerDeviceSession } from "./sign-session";

/**
 * Narrow `chrome.windows`/`chrome.runtime` surface needed to create, track,
 * refocus, and close the dedicated hardware window.
 */
export type GrantBrowser = {
  readonly runtime: {
    readonly getURL: (path: string) => string;
  };
  readonly windows: {
    readonly create: (options: {
      readonly url: string;
      readonly type: "popup";
      readonly width: number;
      readonly height: number;
      readonly focused: boolean;
    }) => Promise<{ readonly id?: number }>;
    readonly get: (windowId: number) => Promise<{ readonly id?: number }>;
    readonly getCurrent: () => Promise<{ readonly id?: number }>;
    readonly onRemoved: {
      readonly addListener: (callback: (windowId: number) => void) => void;
      readonly removeListener: (callback: (windowId: number) => void) => void;
    };
    readonly remove: (windowId: number) => Promise<void>;
    readonly update: (
      windowId: number,
      options: { readonly focused: true },
    ) => Promise<{ readonly id?: number }>;
  };
};

/**
 * Injected upper bound for waiting on the popup or one APDU command. Production
 * uses `setTimeout`; tests inject a deterministic scheduler.
 */
export type GrantWindowTimeout = {
  readonly ms: number;
  readonly schedule: (onElapsed: () => void, ms: number) => () => void;
};

/**
 * Narrow BroadcastChannel surface used by the side-panel proxy.
 */
export type GrantClientChannel = {
  readonly addEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
  readonly close: () => void;
  readonly postMessage: (message: LedgerBrokerCommand) => void;
  readonly removeEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
};

/**
 * Browser-effect factories injected by tests. The random session id is a
 * capability, not account material; production obtains it at this explicit
 * request boundary.
 */
export type GrantSessionRuntime = {
  readonly channel: (name: string) => GrantClientChannel;
  readonly sessionId: () => string;
  readonly timeout: GrantWindowTimeout;
};

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: Partial<GrantBrowser>;
};

const hasGrantBrowserShape = (value: Partial<GrantBrowser> | undefined): value is GrantBrowser =>
  typeof value?.runtime?.getURL === "function" &&
  typeof value?.windows?.create === "function" &&
  typeof value?.windows?.get === "function" &&
  typeof value?.windows?.getCurrent === "function" &&
  typeof value?.windows?.onRemoved?.addListener === "function" &&
  typeof value?.windows?.onRemoved?.removeListener === "function" &&
  typeof value?.windows?.remove === "function" &&
  typeof value?.windows?.update === "function";

/**
 * Reads and validates the extension browser surface, or returns null outside a
 * Chromium extension page.
 */
export const extensionBrowser = (): GrantBrowser | null => {
  const chrome = (globalThis as ExtensionGlobal).chrome;
  return hasGrantBrowserShape(chrome) ? chrome : null;
};

const GRANT_WINDOW_WIDTH = 500;
const GRANT_WINDOW_HEIGHT = 680;
const GRANT_WINDOW_TIMEOUT: GrantWindowTimeout = {
  ms: 120_000,
  schedule: (onElapsed, ms) => {
    const handle = setTimeout(onElapsed, ms);
    return () => clearTimeout(handle);
  },
};
const GRANT_SESSION_RUNTIME: GrantSessionRuntime = {
  channel: (name) => new BroadcastChannel(name),
  sessionId: () => crypto.randomUUID(),
  timeout: GRANT_WINDOW_TIMEOUT,
};

type PendingCommand = {
  readonly cancelTimeout: () => void;
  readonly reject: (error: LedgerRejection) => void;
  readonly resolve: (value: unknown) => void;
};

type LedgerBrokerCall =
  | { readonly kind: "command"; readonly method: "getAppVersion" }
  | { readonly kind: "command"; readonly method: "getPubKey"; readonly path: string }
  | {
      readonly hash: string;
      readonly kind: "command";
      readonly method: "signHash";
      readonly path: string;
    };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isReturnCode = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffff;

const requireBaseResponse = (
  value: unknown,
): Readonly<Record<string, unknown>> & {
  readonly errorMessage: string;
  readonly returnCode: number;
} => {
  if (
    !isRecord(value) ||
    typeof value["errorMessage"] !== "string" ||
    !isReturnCode(value["returnCode"])
  ) {
    throw new LedgerRejection("unexpected-device-error");
  }
  return {
    ...value,
    errorMessage: value["errorMessage"],
    returnCode: value["returnCode"],
  };
};

const requireVersionResponse = (value: unknown) => {
  const response = requireBaseResponse(value);
  const parts = [response["major"], response["minor"], response["patch"]];
  if (
    Object.keys(response).length !== 5 ||
    !parts.every(
      (part) => typeof part === "number" && Number.isSafeInteger(part) && part >= 0 && part <= 0xff,
    )
  ) {
    throw new LedgerRejection("unexpected-device-error");
  }
  return {
    errorMessage: response.errorMessage,
    major: response["major"] as number,
    minor: response["minor"] as number,
    patch: response["patch"] as number,
    returnCode: response.returnCode,
  };
};

const requirePublicKeyResponse = (value: unknown) => {
  const response = requireBaseResponse(value);
  if (
    Object.keys(response).length !== 3 ||
    !(response["publicKey"] instanceof Uint8Array) ||
    response["publicKey"].length !== 64
  ) {
    throw new LedgerRejection("unexpected-device-error");
  }
  return {
    errorMessage: response.errorMessage,
    publicKey: response["publicKey"],
    returnCode: response.returnCode,
  };
};

const requireSignatureResponse = (value: unknown) => {
  const response = requireBaseResponse(value);
  if (
    Object.keys(response).length !== 4 ||
    !(response["r"] instanceof Uint8Array) ||
    response["r"].length !== 32 ||
    !(response["s"] instanceof Uint8Array) ||
    response["s"].length !== 32
  ) {
    throw new LedgerRejection("unexpected-device-error");
  }
  return {
    errorMessage: response.errorMessage,
    r: response["r"],
    returnCode: response.returnCode,
    s: response["s"],
  };
};

/**
 * Opens the dedicated Ledger window and resolves after it has selected a
 * transport and verified the Starknet app. The returned session proxies APDU
 * operations to that retained window and owns its lifecycle; `close()` closes
 * the window, channel, and underlying transport. Closing the popup early rejects
 * with `picker-cancelled`, and every wait is bounded so a lost chooser or
 * context cannot wedge onboarding/signing indefinitely.
 */
export const requestDeviceGrant = async (
  browser: GrantBrowser,
  runtime: GrantSessionRuntime = GRANT_SESSION_RUNTIME,
): Promise<LedgerDeviceSession> => {
  const sessionId = runtime.sessionId();
  const channel = runtime.channel(ledgerBrokerChannelName(sessionId));
  const pending = new Map<number, PendingCommand>();
  let requestId = 0;
  let windowId: number | undefined;
  let ready = false;
  let closed = false;
  let rejectReady: ((error: LedgerRejection) => void) | null = null;
  let resolveReady: (() => void) | null = null;

  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const failPending = (error: LedgerRejection): void => {
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
    browser.windows.onRemoved.removeListener(onRemoved);
    channel.removeEventListener("message", onMessage);
  };

  const onRemoved = (removedId: number): void => {
    if (removedId !== windowId || closed) {
      return;
    }
    closed = true;
    detach();
    channel.close();
    failPending(new LedgerRejection(ready ? "panel-context-lost" : "picker-cancelled"));
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (!isLedgerBrokerResponse(event.data)) {
      return;
    }
    const response: LedgerBrokerResponse = event.data;
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
      command.reject(new LedgerRejection(response.error));
    }
  };

  channel.addEventListener("message", onMessage);
  browser.windows.onRemoved.addListener(onRemoved);

  const parent: { readonly id?: number } = await browser.windows.getCurrent().catch(() => ({}));
  try {
    const created = await browser.windows.create({
      focused: true,
      height: GRANT_WINDOW_HEIGHT,
      type: "popup",
      url: `${browser.runtime.getURL("ledger-grant.html")}#session=${sessionId}`,
      width: GRANT_WINDOW_WIDTH,
    });
    windowId = created.id;
  } catch {
    closed = true;
    detach();
    channel.close();
    throw new LedgerRejection("unexpected-device-error");
  }

  if (windowId === undefined) {
    closed = true;
    detach();
    channel.close();
    throw new LedgerRejection("unexpected-device-error");
  }

  // Catch a close that raced window creation/listener registration.
  void browser.windows.get(windowId).catch(() => onRemoved(windowId as number));

  const cancelReadyTimeout = runtime.timeout.schedule(() => {
    if (!ready && !closed) {
      closed = true;
      detach();
      channel.close();
      failPending(new LedgerRejection("picker-cancelled"));
      void browser.windows.remove(windowId as number).catch(() => undefined);
    }
  }, runtime.timeout.ms);

  await readyPromise.finally(cancelReadyTimeout);
  if (parent.id !== undefined) {
    await browser.windows.update(parent.id, { focused: true }).catch(() => undefined);
  }

  const call = (command: LedgerBrokerCall) =>
    new Promise<unknown>((resolve, reject) => {
      if (closed) {
        reject(new LedgerRejection("panel-context-lost"));
        return;
      }
      requestId += 1;
      const id = requestId;
      const cancelTimeout = runtime.timeout.schedule(() => {
        const command = pending.get(id);
        if (!command) {
          return;
        }
        pending.delete(id);
        command.reject(new LedgerRejection("sign-timeout"));
      }, runtime.timeout.ms);
      pending.set(id, {
        cancelTimeout,
        reject: (error) => reject(error),
        resolve,
      });
      channel.postMessage({ ...command, id } as LedgerBrokerCommand);
    });

  return {
    client: {
      getAppVersion: async () =>
        requireVersionResponse(await call({ kind: "command", method: "getAppVersion" })),
      getPubKey: async (path) =>
        requirePublicKeyResponse(await call({ kind: "command", method: "getPubKey", path })),
      signHash: async (path, hash) =>
        requireSignatureResponse(await call({ hash, kind: "command", method: "signHash", path })),
    },
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      channel.postMessage({ kind: "close" });
      detach();
      channel.close();
      failPending(new LedgerRejection("panel-context-lost"));
      await browser.windows.remove(windowId as number).catch(() => undefined);
    },
  };
};
