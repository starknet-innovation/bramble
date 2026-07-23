/**
 * Standalone popup page that obtains the one-time WebHID grant for a Ledger.
 * Chrome cannot render its device chooser inside an extension side panel —
 * `navigator.hid.requestDevice()` resolves with an empty list there, even
 * though the device is visible in `chrome://device-log` — so this small
 * top-level window is the ONLY place `requestDevice` is ever called. The grant
 * it produces is origin-wide and persists, so the side panel reconnects
 * silently afterward through `getDevices()` (see
 * `../sidepanel/ledger/transport.ts`'s `openConnectedTransport`, reached via
 * `../sidepanel/ledger/grant-window.ts`'s `requestDeviceGrant`, which opens this
 * page) — no picker on this or any future connect.
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
  readonly windows?: {
    readonly getCurrent: () => Promise<{ readonly id?: number }>;
    readonly remove: (windowId: number) => Promise<void>;
  };
};

type GrantGlobal = typeof globalThis & { readonly chrome?: GrantChrome };

const webHid = (): WebHidApi | null => (navigator as NavigatorWithHid).hid ?? null;

// Closes this popup once the grant is settled. Best-effort: outside a real
// extension window (e.g. this file loaded stand-alone) there is nothing to
// close, so a missing `chrome.windows` surface is silently skipped rather than
// thrown.
const closeThisWindow = async (): Promise<void> => {
  const windows = (globalThis as GrantGlobal).chrome?.windows;
  const current = await windows?.getCurrent();
  if (current?.id !== undefined) {
    await windows?.remove(current.id);
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
    "Plug in your Ledger, unlock it, and open the Starknet app. Then choose it below.";

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
        status.textContent = "No Ledger was selected. You can close this window and try again.";
        button.disabled = false;
        return;
      }
      status.textContent = "Connected. Closing this window…";
      await closeThisWindow();
    } catch {
      status.textContent =
        "Couldn't connect to your Ledger. You can close this window and try again.";
      button.disabled = false;
    }
  };

  button.addEventListener("click", () => {
    void connect();
  });

  app.replaceChildren(heading, copy, button, status);
};

render();
