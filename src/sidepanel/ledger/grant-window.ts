/**
 * Browser-tab boundary for the one-time Ledger WebHID grant. Chrome renders its
 * WebHID device chooser only for an ordinary browser tab. From an extension
 * side panel — and, as this module previously learned the hard way, from a
 * `chrome.windows.create({ type: "popup" })` window as well —
 * `navigator.hid.requestDevice()` resolves with an EMPTY device list instead of
 * rejecting, even while the OS has the device enumerated and it is visible in
 * `chrome://device-log`. Both contexts were observed returning `[]` against a
 * physically connected, unlocked Ledger Nano X (vendor `0x2c97`, vendor-defined
 * usage page `0xFFA0`), including with `filters: []`, while the same page opened
 * as a normal tab listed the device immediately. An empty popup chooser is
 * therefore indistinguishable from a real cancel, which is exactly why the grant
 * must be collected in a tab.
 *
 * This module owns opening that tab (`ledger-grant.html`, built from
 * `../../ledger-grant/index.ts`) and waiting for the user to finish with it; the
 * grant it produces is origin-wide and persists, so `./transport.ts`'s
 * `openConnectedTransport` can reconnect silently afterward with no further
 * chooser. Only `./sign-connector.ts` calls this — the rest of the side panel
 * never touches `chrome.tabs`.
 */

/**
 * The narrow `chrome.tabs`/`chrome.runtime` surface this boundary needs:
 * resolving the grant page's URL, opening it as a tab, and being told when that
 * tab closes. Hand-typed, like this repo's other browser-global surfaces (e.g.
 * `../../storage/browser-storage.ts`), so nothing here depends on
 * `@types/chrome`. None of these calls require the `tabs` manifest permission —
 * that permission gates reading privileged tab fields (`url`, `title`,
 * `favIconUrl`), not creating, closing, or observing a tab.
 *
 * `chrome.tabs.onRemoved` really invokes its listener with `(tabId, removeInfo)`;
 * the extra argument is deliberately left off this surface because nothing here
 * reads it, and a narrower callback stays assignable to the wider real one.
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
 * Injected upper bound for waiting on a grant tab. The production boundary uses
 * `setTimeout`; tests inject a deterministic scheduler.
 */
export type GrantTabTimeout = {
  readonly ms: number;
  readonly schedule: (onElapsed: () => void, ms: number) => () => void;
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
 * Reads `globalThis.chrome` and narrows it to {@link GrantBrowser}, or `null`
 * outside an extension context (for example under `bun test`). Production
 * code calls this once and passes the result to {@link requestDeviceGrant};
 * tests inject a fake `GrantBrowser` directly instead.
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

/**
 * Opens the Ledger grant page (`ledger-grant.html`) as a foreground tab and
 * resolves once the user closes it — after they either grant a device or give
 * up — or once the bounded wait expires. It does not read the outcome itself:
 * `./transport.ts`'s `openConnectedTransport` (called again by
 * `./sign-connector.ts` after this resolves) is what tells the caller whether a
 * grant now exists. Matches the closed tab by id so an unrelated tab closing
 * elsewhere never resolves this early, probes for a close that raced listener
 * registration, and always removes its `onRemoved` listener and timeout on the
 * way out so repeated calls never accumulate resources. A timeout best-effort
 * closes the tab and lets the caller retry the silent grant check rather than
 * hanging connect forever. Resolves immediately, registering no listener at all,
 * if the created tab has no id — there is nothing to wait for.
 */
export const requestDeviceGrant = async (
  browser: GrantBrowser,
  timeout: GrantTabTimeout = GRANT_TAB_TIMEOUT,
): Promise<void> => {
  const created = await browser.tabs.create({
    active: true,
    url: browser.runtime.getURL("ledger-grant.html"),
  });

  const tabId = created.id;
  if (tabId === undefined) {
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
      browser.tabs.onRemoved.removeListener(onRemoved);
      cancelTimeout();
      resolve();
    };
    const onRemoved = (closedId: number): void => {
      if (closedId !== tabId) {
        return;
      }
      finish();
    };
    browser.tabs.onRemoved.addListener(onRemoved);
    const cancel = timeout.schedule(() => {
      finish();
      void browser.tabs.remove(tabId).catch(() => undefined);
    }, timeout.ms);
    cancelTimeout = cancel;
    if (finished) {
      cancelTimeout();
      return;
    }
    // The tab can close between `tabs.create` resolving and listener
    // registration. Probe it once after the listener is live so that missed
    // close also resolves instead of wedging connect forever.
    void browser.tabs.get(tabId).catch(finish);
  });
};
