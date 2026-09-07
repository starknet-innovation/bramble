/**
 * Top-level Ledger hardware-tab boundary. Chrome exposes its native hardware
 * chooser only from an ordinary browser tab: extension side panels and
 * `chrome.windows.create({ type: "popup" })` windows can resolve with an empty
 * device list even when the OS sees the Ledger. Stable Web Bluetooth also does
 * not expose `Bluetooth.getDevices()` for a later silent reopen. The
 * gesture-owning tab therefore retains the live transport for the current
 * read/sign operation and this module presents it as an owned
 * {@link LedgerDeviceSession} to the side panel.
 *
 * Communication uses a per-tab, random-capability BroadcastChannel scoped
 * to this extension origin. Both ends validate every message; only canonical
 * Ledger paths, Stark hashes, public app/key responses, and raw signatures can
 * cross it. Private keys and device identifiers never do.
 */
import { isRecord } from "@bramble/core/json";
import {
  isLedgerBrokerResponse,
  type LedgerBrokerCommand,
  type LedgerBrokerResponse,
  ledgerBrokerChannelName,
} from "@bramble/ledger-protocol/broker";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";
import type { LedgerDeviceSession } from "@bramble/ledger-protocol/session";

/**
 * Narrow `chrome.tabs`/`chrome.runtime` surface needed to create, track, and
 * close the dedicated hardware tab. These calls do not require the `tabs`
 * manifest permission because no privileged tab metadata is read.
 */
export type GrantBrowser = {
  readonly runtime: {
    readonly getURL: (path: string) => string;
  };
  readonly tabs: {
    readonly create: (options: {
      readonly url: string;
      readonly active: boolean;
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
 * Injected upper bound for waiting on the tab or one APDU command. Production
 * uses `setTimeout`; tests inject a deterministic scheduler.
 */
export type GrantTabTimeout = {
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
  readonly timeout: GrantTabTimeout;
};

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: Partial<GrantBrowser>;
};

const hasGrantBrowserShape = (value: Partial<GrantBrowser> | undefined): value is GrantBrowser =>
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
export const extensionBrowser = (): GrantBrowser | null => {
  const chrome = (globalThis as ExtensionGlobal).chrome;
  return hasGrantBrowserShape(chrome) ? chrome : null;
};

const GRANT_TAB_TIMEOUT: GrantTabTimeout = {
  ms: 120_000,
  schedule: (onElapsed, ms) => {
    const handle = setTimeout(onElapsed, ms);
    return () => clearTimeout(handle);
  },
};
const GRANT_SESSION_RUNTIME: GrantSessionRuntime = {
  channel: (name) => new BroadcastChannel(name),
  sessionId: () => crypto.randomUUID(),
  timeout: GRANT_TAB_TIMEOUT,
};

type PendingCommand = {
  readonly cancelTimeout: () => void;
  readonly reject: (error: LedgerRejection) => void;
  readonly resolve: (value: unknown) => void;
};

type LedgerBrokerCall =
  | { readonly kind: "command"; readonly method: "getOsVersion" }
  | { readonly kind: "command"; readonly method: "getAppVersion" }
  | { readonly kind: "command"; readonly method: "getPubKey"; readonly path: string }
  | {
      readonly hash: string;
      readonly kind: "command";
      readonly method: "signHash";
      readonly path: string;
    };

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

const requireOsVersionResponse = (value: unknown) => {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value["targetId"] !== "number" ||
    !Number.isSafeInteger(value["targetId"]) ||
    value["targetId"] < 0 ||
    value["targetId"] > 0xffffffff ||
    typeof value["version"] !== "string"
  ) {
    throw new LedgerRejection("unexpected-device-error");
  }
  return { targetId: value["targetId"], version: value["version"] };
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
 * Opens the dedicated Ledger tab and resolves after it has selected a
 * transport and verified the Starknet app. The returned session proxies APDU
 * operations to that retained tab and owns its lifecycle; `close()` closes
 * the tab, channel, and underlying transport. Closing the tab early rejects
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
  let tabId: number | undefined;
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
  browser.tabs.onRemoved.addListener(onRemoved);

  try {
    const created = await browser.tabs.create({
      active: true,
      url: `${browser.runtime.getURL("ledger-grant.html")}#session=${sessionId}`,
    });
    tabId = created.id;
  } catch {
    closed = true;
    detach();
    channel.close();
    throw new LedgerRejection("unexpected-device-error");
  }

  if (tabId === undefined) {
    closed = true;
    detach();
    channel.close();
    throw new LedgerRejection("unexpected-device-error");
  }

  // Catch a close that raced tab creation/listener registration.
  void browser.tabs.get(tabId).catch(() => onRemoved(tabId as number));

  const cancelReadyTimeout = runtime.timeout.schedule(() => {
    if (!ready && !closed) {
      closed = true;
      detach();
      channel.close();
      failPending(new LedgerRejection("picker-cancelled"));
      void browser.tabs.remove(tabId as number).catch(() => undefined);
    }
  }, runtime.timeout.ms);

  await readyPromise.finally(cancelReadyTimeout);
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
      getOsVersion: async () =>
        requireOsVersionResponse(await call({ kind: "command", method: "getOsVersion" })),
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
      await browser.tabs.remove(tabId as number).catch(() => undefined);
    },
    readiness: "verified",
  };
};
