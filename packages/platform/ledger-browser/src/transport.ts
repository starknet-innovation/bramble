/**
 * Browser transport boundary for the side panel — the ONE place a live Ledger
 * device is opened after permission is granted. It must run in a Window
 * context, never the service worker. This module silently reopens origin-granted
 * WebUSB/WebHID cable devices. The standalone grant tab separately owns Web
 * Bluetooth for the current operation because stable Chrome cannot enumerate
 * paired Bluetooth devices for a silent reopen. Construction wraps the transport in the
 * `@ledgerhq/hw-app-starknet` `StarknetClient`, exposed through the structural
 * {@link LedgerDeviceClient} so the rest of the flow stays hardware-agnostic
 * and testable.
 *
 * The concrete Ledger libraries are imported only from the runtime-only
 * `webhid-impl.js` shim (their vendored `.d.ts` does not compile under the
 * repo's pinned `skipLibCheck: false`), so this typed module maps open failures
 * to the {@link LedgerRejection} catalog and never touches those declarations.
 * Device I/O cannot be exercised without a real Ledger and Chromium, so
 * it is deliberately thin: open failures are classified in `transport-error.ts`.
 */

import {
  type LedgerTransport,
  listConnectedDevicesRaw,
  newStarknetClient,
  openConnectedTransportRaw,
} from "@bramble/ledger-browser/webhid";
import { ledgerBrokerSessionFromHash } from "@bramble/ledger-protocol/broker";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";
import type { LedgerDeviceChoice } from "@bramble/ledger-protocol/session";
import {
  classifyLedgerTransportError,
  ledgerTransportRejection,
} from "@bramble/ledger-protocol/transport-error";
import { browserLedgerLocks, isLedgerGrantTabOrphaned } from "./panel-presence";

type NavigatorWithLedgerTransport = {
  readonly bluetooth?: unknown;
  readonly hid?: unknown;
  readonly usb?: unknown;
};

/**
 * True when the runtime exposes Web Bluetooth, WebUSB, or WebHID. This is
 * capability detection, not a permission check; the grant tab still owns
 * the user gesture.
 */
export const isLedgerTransportAvailable = (): boolean =>
  typeof navigator !== "undefined" &&
  ((navigator as NavigatorWithLedgerTransport).bluetooth !== undefined ||
    (navigator as NavigatorWithLedgerTransport).usb !== undefined ||
    (navigator as NavigatorWithLedgerTransport).hid !== undefined);

type GrantContext = {
  readonly documentUrl?: string;
  readonly tabId?: number;
};

type GrantTab = {
  readonly pendingUrl?: string;
  readonly url?: string;
};

type ExtensionGlobal = {
  readonly runtime?: {
    readonly getContexts?: (filter: {
      readonly contextTypes: readonly ["TAB"];
    }) => Promise<readonly GrantContext[]>;
    readonly getURL?: (path: string) => string;
  };
  readonly tabs?: {
    readonly get?: (tabId: number) => Promise<GrantTab | undefined>;
    readonly remove?: (tabId: number) => Promise<void>;
  };
};

const extensionGlobal = (): ExtensionGlobal | undefined => {
  const scope = globalThis as { browser?: ExtensionGlobal; chrome?: ExtensionGlobal };
  return scope.browser ?? scope.chrome;
};

const isGrantPage = (url: string | undefined, prefix: string): boolean =>
  typeof url === "string" && url.startsWith(prefix);

// This extension has no `tabs` permission, so `tabs.get` omits `url`. A missing
// URL is not evidence the user left. A URL that is present and is no longer
// the grant page is. The context list is read again immediately before
// removal: it includes the document URL of our own pages.
const tabLeftGrantPage = (tab: GrantTab, prefix: string): boolean =>
  (tab.url !== undefined && !isGrantPage(tab.url, prefix)) ||
  (tab.pendingUrl !== undefined && !isGrantPage(tab.pendingUrl, prefix));

const grantTabStillThere = async (
  extension: ExtensionGlobal,
  tabId: number,
  prefix: string,
): Promise<boolean> => {
  const tab = await extension.tabs?.get?.(tabId).catch(() => undefined);
  if (tab && tabLeftGrantPage(tab, prefix)) return false;
  const contexts = await extension.runtime
    ?.getContexts?.({ contextTypes: ["TAB"] })
    .catch(() => undefined);
  if (!contexts) return false;
  return contexts.some(
    (context) => context.tabId === tabId && isGrantPage(context.documentUrl, prefix),
  );
};

/**
 * Closes a hardware tab only when its shared wait shows the panel held the
 * lock and let it go. A tab with no lock is left alone: the panel may have
 * failed to take the lock and still be using it. Returns
 * true when at least one tab was closed, so the caller may retry an open that
 * failed because that tab still held the device. With no extension API or no
 * Web Locks it closes nothing and the caller shows the busy error.
 */
const releaseOrphanLedgerGrantTabs = async (): Promise<boolean> => {
  const extension = extensionGlobal();
  const prefix = extension?.runtime?.getURL?.("ledger-grant.html");
  const remove = extension?.tabs?.remove;
  const locks = browserLedgerLocks();
  if (!prefix || !extension?.runtime?.getContexts || !remove || !locks) return false;
  const contexts = await extension.runtime.getContexts({ contextTypes: ["TAB"] }).catch(() => []);
  let released = false;
  for (const context of contexts) {
    const url = context.documentUrl;
    if (typeof context.tabId !== "number" || !url?.startsWith(prefix)) continue;
    const sessionId = ledgerBrokerSessionFromHash(url.slice(prefix.length));
    if (!sessionId) continue;
    const orphaned = await isLedgerGrantTabOrphaned(locks, sessionId).catch(() => false);
    if (!orphaned) continue;
    const stillThere = await grantTabStillThere(extension, context.tabId, prefix);
    if (!stillThere) continue;
    const removed = await remove(context.tabId).then(
      () => true,
      () => false,
    );
    released ||= removed;
  }
  return released;
};

// A closed tab's document can take a moment to give the USB claim back.
const CLAIM_SETTLE_MS = 250;

const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, CLAIM_SETTLE_MS);
  });

// The open path has already retried its own stale handle inside the cable
// transport. Drop `ownStale` so the caller does not open a second time.
const finalRejection = (error: unknown): LedgerRejection => {
  const failure = classifyLedgerTransportError(error);
  return new LedgerRejection(failure.code, undefined, {
    ...(failure.causeName ? { causeName: failure.causeName } : {}),
  });
};

// WebUSB reports another holder as device-busy. WebHID reports the same
// situation, including this extension's own grant tab, as NotAllowedError
// "Failed to open the device." A denied permission uses that name too, so it
// stays the generic error unless closing an orphan tab lets the open succeed.
const mayBeGrantTabHold = (failure: ReturnType<typeof classifyLedgerTransportError>): boolean =>
  failure.code === "device-busy" || failure.causeName === "NotAllowedError";

const openOrHold = async (
  deviceId?: string,
): Promise<{ readonly transport: LedgerTransport | null } | { readonly hold: unknown }> => {
  try {
    return { transport: await openConnectedTransportRaw(deviceId) };
  } catch (error) {
    if (!mayBeGrantTabHold(classifyLedgerTransportError(error))) throw finalRejection(error);
    return { hold: error };
  }
};

const openConnectedOnce = async (deviceId?: string): Promise<LedgerTransport | null> => {
  const first = await openOrHold(deviceId);
  if (!("hold" in first)) return first.transport;
  const released = await releaseOrphanLedgerGrantTabs();
  if (released) {
    const second = await openOrHold(deviceId);
    if (!("hold" in second)) return second.transport;
  }
  // The grant tab may already be gone from the extension contexts while its
  // document is still releasing the USB or HID claim.
  await settle();
  const last = await openOrHold(deviceId);
  if (!("hold" in last)) return last.transport;
  throw finalRejection(last.hold);
};

/**
 * Silently reopens an already-granted device (no permission prompt). Returns
 * null when no granted device is connected, so the caller can fall back to the
 * grant tab (`./grant-window`'s `requestDeviceGrant`, driven by
 * `./sign-connector.ts`) and retry. Cable device grants are origin-wide and
 * survive restarts, so this is the normal cable reconnect path. Bluetooth
 * sessions are retained and proxied by the dedicated hardware tab instead.
 */
export const openConnectedTransport = (deviceId?: string): Promise<LedgerTransport | null> =>
  openConnectedOnce(deviceId);

/**
 * Lists every already-granted connected Ledger without opening it. Opaque ids
 * let the UI select one exact device when several are connected; no key,
 * address, or other wallet material is included in the descriptor.
 */
export const listConnectedDevices = async (): Promise<readonly LedgerDeviceChoice[]> => {
  try {
    return await listConnectedDevicesRaw();
  } catch (error) {
    throw ledgerTransportRejection(error);
  }
};

/**
 * Wraps an open transport in the Starknet APDU client used by the device flow.
 */
export const deviceClientFrom = (transport: LedgerTransport): LedgerDeviceClient =>
  newStarknetClient(transport);

/**
 * Closes an open transport, releasing the browser device so it is not left
 * claimed. Propagates any close error to the caller, which closes in a `finally`
 * and must not let a close failure mask the operation's real result (fail
 * closed). This is the counterpart to {@link openConnectedTransport}; the
 * device is opened and closed only here.
 */
export const closeTransport = (transport: LedgerTransport): Promise<void> => transport.close();
