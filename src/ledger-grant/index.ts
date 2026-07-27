/**
 * Standalone page that obtains the one-time WebHID grant for a Ledger. Chrome
 * renders its device chooser only for an ordinary browser tab:
 * `navigator.hid.requestDevice()` resolves with an empty list in an extension
 * side panel AND in a `chrome.windows.create({ type: "popup" })` window, even
 * though the device is visible in `chrome://device-log` — so this page, opened
 * as a TAB by `../sidepanel/ledger/grant-window.ts`'s `requestDeviceGrant`, is
 * the ONLY place `requestDevice` is ever called. Do not reintroduce a popup
 * window here; that was the original bug. The grant it produces is origin-wide
 * and persists, so the side panel reconnects silently afterward through
 * `getDevices()` (see `../sidepanel/ledger/transport.ts`'s
 * `openConnectedTransport`) — no chooser on any future connect.
 *
 * Deliberately framework-free: one button, one status line, a hand-rolled
 * WebHID/chrome type surface (matching the hand-typed surfaces elsewhere at
 * this repo's browser-global boundaries, e.g. `../sidepanel/ledger/transport.ts`'s
 * `NavigatorWithHid`), and no logic beyond "ask, report, close". This is an
 * entrypoint loaded only by `ledger-grant.html`, never imported by another
 * module, so — like `../sidepanel/index.ts` — it stays outside the
 * `check:coverage` unit-test floor; it is exercised by hand against a real
 * Ledger and Chromium WebHID instead.
 */

// Ledger's USB vendor id, used to filter the device chooser to Ledger hardware.
const LEDGER_USB_VENDOR_ID = 0x2c97;

type WebHidApi = {
  readonly requestDevice: (options: {
    readonly filters: readonly { readonly vendorId: number }[];
  }) => Promise<readonly unknown[]>;
};

type NavigatorWithHid = { readonly hid?: WebHidApi };

type GrantChrome = {
  readonly tabs?: {
    readonly getCurrent: () => Promise<{ readonly id?: number } | undefined>;
    readonly remove: (tabId: number) => Promise<void>;
  };
};

type GrantGlobal = typeof globalThis & { readonly chrome?: GrantChrome };

const webHid = (): WebHidApi | null => (navigator as NavigatorWithHid).hid ?? null;

// Closes this tab once the grant is settled. Deliberately scoped to the TAB,
// never the window: this page is opened as one tab inside the user's ordinary
// browser window, so removing the window would take every unrelated tab in it
// with it. Best-effort — outside a real extension tab (e.g. this file loaded
// stand-alone) `getCurrent` yields nothing to close, so a missing
// `chrome.tabs` surface or absent tab is silently skipped rather than thrown.
const closeThisTab = async (): Promise<void> => {
  const tabs = (globalThis as GrantGlobal).chrome?.tabs;
  const current = await tabs?.getCurrent();
  if (current?.id !== undefined) {
    await tabs?.remove(current.id);
  }
};

const render = (): void => {
  const app = document.querySelector("#app");
  if (!app) {
    return;
  }

  const heading = document.createElement("h1");
  heading.textContent = "Connect your Ledger";

  const copy = document.createElement("p");
  copy.textContent =
    "Connect your Ledger by USB, unlock it, and open the Starknet app. Then choose it below.";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Connect";

  const status = document.createElement("p");
  status.setAttribute("role", "status");

  // Closes over the elements above (rather than taking them as parameters) so
  // mutating their state on each outcome doesn't trip the repo's no-parameter-
  // mutation lint rule.
  const connect = async (): Promise<void> => {
    const hid = webHid();
    if (!hid) {
      status.textContent = "This browser doesn't support WebHID.";
      return;
    }

    button.disabled = true;
    status.textContent = "Choosing device…";

    try {
      const devices = await hid.requestDevice({ filters: [{ vendorId: LEDGER_USB_VENDOR_ID }] });
      if (devices.length === 0) {
        // Chrome resolves with an empty list both when the chooser was
        // dismissed and when it had nothing to offer, and exposes no way to
        // tell those apart — so this must not assert that the user cancelled.
        status.textContent =
          "No Ledger was chosen. If the list was empty, check that your Ledger is connected by USB, unlocked, and showing the Starknet app, then try again.";
        button.disabled = false;
        return;
      }
      status.textContent = "Connected. Closing this tab…";
      await closeThisTab();
    } catch {
      status.textContent = "Couldn't connect to your Ledger. You can close this tab and try again.";
      button.disabled = false;
    }
  };

  button.addEventListener("click", () => {
    void connect();
  });

  app.replaceChildren(heading, copy, button, status);
};

render();
