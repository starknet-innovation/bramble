/**
 * Popup-window boundary for the one-time Ledger WebHID grant. Chrome cannot
 * render the WebHID device chooser inside an extension side panel — the
 * picker resolves with an empty device list there, even though the device
 * shows in `chrome://device-log` — so the grant has to be collected in an
 * ordinary top-level window instead. This module owns opening that window
 * (`ledger-grant.html`, built from `../../ledger-grant/index.ts`) and waiting
 * for the user to finish with it; the grant it produces is origin-wide and
 * persists, so `./transport.ts`'s `openConnectedTransport` can reconnect
 * silently afterward with no further picker. Only `./sign-connector.ts` calls
 * this — the rest of the side panel never touches `chrome.windows`.
 */

/**
 * The narrow `chrome.windows`/`chrome.runtime` surface this boundary needs:
 * resolving the grant page's URL, opening it as a popup, and being told when
 * it closes. Hand-typed, like this repo's other browser-global surfaces (e.g.
 * `../../storage/browser-storage.ts`), so nothing here depends on
 * `@types/chrome`.
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
    readonly onRemoved: {
      readonly addListener: (callback: (windowId: number) => void) => void;
      readonly removeListener: (callback: (windowId: number) => void) => void;
    };
    readonly remove: (windowId: number) => Promise<void>;
  };
};

/**
 * Injected upper bound for waiting on a grant popup. The production boundary
 * uses `setTimeout`; tests inject a deterministic scheduler.
 */
export type GrantWindowTimeout = {
  readonly ms: number;
  readonly schedule: (onElapsed: () => void, ms: number) => () => void;
};

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: Partial<GrantBrowser>;
};

const hasGrantBrowserShape = (value: Partial<GrantBrowser> | undefined): value is GrantBrowser =>
  typeof value?.runtime?.getURL === "function" &&
  typeof value?.windows?.create === "function" &&
  typeof value?.windows?.get === "function" &&
  typeof value?.windows?.onRemoved?.addListener === "function" &&
  typeof value?.windows?.onRemoved?.removeListener === "function" &&
  typeof value?.windows?.remove === "function";

/**
 * Reads `globalThis.chrome` and narrows it to {@link GrantBrowser}, or `null`
 * outside an extension context (for example under `bun test`). Production
 * code calls this once and passes the result to {@link requestDeviceGrant};
 * tests inject a fake `GrantBrowser` directly instead.
 */
export const extensionBrowser = (): GrantBrowser | null => {
  const chrome = (globalThis as ExtensionGlobal).chrome;
  return hasGrantBrowserShape(chrome) ? chrome : null;
};

const GRANT_WINDOW_WIDTH = 460;
const GRANT_WINDOW_HEIGHT = 420;
const GRANT_WINDOW_TIMEOUT: GrantWindowTimeout = {
  ms: 120_000,
  schedule: (onElapsed, ms) => {
    const handle = setTimeout(onElapsed, ms);
    return () => clearTimeout(handle);
  },
};

/**
 * Opens the Ledger grant page (`ledger-grant.html`) as a small focused popup
 * and resolves once the user closes it — after they either grant a device or
 * give up — or once the bounded wait expires. It does not read the outcome
 * itself: `./transport.ts`'s
 * `openConnectedTransport` (called again by `./sign-connector.ts` after this
 * resolves) is what tells the caller whether a grant now exists. Matches the
 * closed window by id so an unrelated window closing elsewhere never resolves
 * this early, probes for a close that raced listener registration, and always
 * removes its `onRemoved` listener and timeout on the way out so repeated calls
 * never accumulate resources. A timeout best-effort closes the popup and lets
 * the caller retry the silent grant check rather than hanging connect forever.
 * Resolves immediately, registering no listener at all, if the created window
 * has no id — there is nothing to wait for.
 */
export const requestDeviceGrant = async (
  browser: GrantBrowser,
  timeout: GrantWindowTimeout = GRANT_WINDOW_TIMEOUT,
): Promise<void> => {
  const created = await browser.windows.create({
    focused: true,
    height: GRANT_WINDOW_HEIGHT,
    type: "popup",
    url: browser.runtime.getURL("ledger-grant.html"),
    width: GRANT_WINDOW_WIDTH,
  });

  const windowId = created.id;
  if (windowId === undefined) {
    return;
  }

  await new Promise<void>((resolve) => {
    let finished = false;
    let cancelTimeout = (): void => undefined;
    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      browser.windows.onRemoved.removeListener(onRemoved);
      cancelTimeout();
      resolve();
    };
    const onRemoved = (closedId: number): void => {
      if (closedId !== windowId) {
        return;
      }
      finish();
    };
    browser.windows.onRemoved.addListener(onRemoved);
    const cancel = timeout.schedule(() => {
      finish();
      void browser.windows.remove(windowId).catch(() => undefined);
    }, timeout.ms);
    cancelTimeout = cancel;
    if (finished) {
      cancelTimeout();
      return;
    }
    // The popup can close between `windows.create` resolving and listener
    // registration. Probe it once after the listener is live so that missed
    // close also resolves instead of wedging connect forever.
    void browser.windows.get(windowId).catch(finish);
  });
};
