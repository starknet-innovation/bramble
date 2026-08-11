/**
 * Behavioural coverage for the DOM-bound Ledger signing runtime under happy-dom.
 * It drives the real `createLedgerSignRuntime` with an injected fake connector
 * and wallet, asserting a parked sign takes the overlay, the device (r, s) is
 * reported and the overlay dismisses on success, the connect gesture is wired to
 * a real button click, and cancel reports a clean rejection.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { LedgerDeviceClient } from "@mc-wallet/ledger-protocol/client";
import { ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import type {
  LedgerSignRequestSummary,
  WalletStatus,
} from "../../../../src/popup/responses/responses";
import type { LedgerSignOutcome } from "../../../../src/sidepanel/journeys/ledger/runtime-client";
import { createLedgerSignRuntime } from "../../../../src/sidepanel/journeys/ledger/sign-runtime";
import type {
  LedgerConnector,
  LedgerDeviceSession,
} from "../../../../src/sidepanel/journeys/ledger/sign-session";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const PENDING: LedgerSignRequestSummary = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  id: "ledger-sign-1",
  messageHash: "0xabc",
  path: ledgerAccountPath(0),
  publicKeyX: "0xabc",
};

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// A 64-byte device key X‖Y whose X-coordinate canonicalizes to PENDING.publicKeyX
// ("0xabc"), so the sign path's shared pre-check (version + key match) passes.
const DEVICE_PUBLIC_KEY = Uint8Array.from([
  ...Array(30).fill(0),
  0x0a,
  0xbc,
  ...Array(32).fill(0xff),
]);

const okVersion = (): ReturnType<LedgerDeviceClient["getAppVersion"]> =>
  Promise.resolve({ errorMessage: "No errors", major: 2, minor: 4, patch: 0, returnCode: 0x9000 });

const okOsVersion = (): ReturnType<LedgerDeviceClient["getOsVersion"]> =>
  Promise.resolve({ targetId: 0x33000004, version: "2.7.1" });

const okPubKey = (): ReturnType<LedgerDeviceClient["getPubKey"]> =>
  Promise.resolve({ errorMessage: "No errors", publicKey: DEVICE_PUBLIC_KEY, returnCode: 0x9000 });

const fakeClient = (
  signHash: LedgerDeviceClient["signHash"],
  overrides: Partial<LedgerDeviceClient> = {},
): LedgerDeviceClient => ({
  getOsVersion: okOsVersion,
  getAppVersion: okVersion,
  getPubKey: okPubKey,
  signHash,
  ...overrides,
});

const okClient = (): LedgerDeviceClient =>
  fakeClient(() =>
    Promise.resolve({
      errorMessage: "No errors",
      r: new Uint8Array([...Array(31).fill(0), 1]),
      returnCode: 0x9000,
      s: new Uint8Array([...Array(31).fill(0), 2]),
    }),
  );

// A connector expressed in terms of the device CLIENT; the harness wraps each
// resolved client in an OWNED session whose `close` bumps a counter, so the
// runtime tests confirm the transport is released without a real WebHID handle.
type ClientConnector = {
  readonly listConnected?: LedgerConnector["listConnected"];
  readonly openConnected: (deviceId?: string) => Promise<LedgerDeviceClient | null>;
  readonly request: () => Promise<LedgerDeviceClient>;
};

type Harness = {
  readonly closed: () => number;
  readonly mount: HTMLElement;
  readonly signatureReports: () => number;
  readonly reports: LedgerSignOutcome[];
};

const mountRuntime = (
  source: ClientConnector,
  pending: readonly LedgerSignRequestSummary[],
): Harness & { readonly poll: () => Promise<void> } => {
  document.body.replaceChildren();
  const mount = document.createElement("div");
  // Mirror the host (index.ts), which appends the overlay hidden.
  mount.hidden = true;
  document.body.append(mount);
  const reports: LedgerSignOutcome[] = [];
  let closed = 0;
  let signatureReports = 0;
  const wrap = (client: LedgerDeviceClient): LedgerDeviceSession => ({
    client,
    close: () => {
      closed += 1;
      return Promise.resolve();
    },
  });
  const connector: LedgerConnector = {
    ...(source.listConnected ? { listConnected: source.listConnected } : {}),
    openConnected: (deviceId) =>
      source.openConnected(deviceId).then((client) => (client ? wrap(client) : null)),
    request: () => source.request().then(wrap),
  };
  const runtime = createLedgerSignRuntime({
    connector,
    mount,
    onSignatureReported: () => {
      signatureReports += 1;
    },
    status: () => status,
    wallet: {
      completeLedgerSign: (outcome) => {
        reports.push(outcome);
        return Promise.resolve();
      },
      loadLedgerSignPending: () => Promise.resolve(pending),
    },
  });
  return {
    closed: () => closed,
    mount,
    poll: runtime.poll,
    reports,
    signatureReports: () => signatureReports,
  };
};

const click = (mount: HTMLElement, selector: string): void => {
  const button = mount.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`missing ${selector}`);
  }
  button.dispatchEvent(new window.Event("click", { bubbles: true }));
};

describe("Ledger sign runtime (DOM)", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("no pending sign leaves the overlay empty", async () => {
    const h = mountRuntime(
      {
        openConnected: () => Promise.resolve(okClient()),
        request: () => Promise.reject(new Error("x")),
      },
      [],
    );
    await h.poll();
    await tick();
    expect(h.reports).toEqual([]);
    expect(h.mount.hidden).toBe(true);
    expect(h.mount.children.length).toBe(0);
  });

  test("a parked sign takes the overlay, signs silently, and dismisses", async () => {
    const h = mountRuntime(
      {
        openConnected: () => Promise.resolve(okClient()),
        request: () => Promise.reject(new Error("x")),
      },
      [PENDING],
    );
    await h.poll();
    await tick();

    expect(h.reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
    // Dismissed after success, and the owned transport was released.
    expect(h.mount.hidden).toBe(true);
    expect(h.mount.children.length).toBe(0);
    expect(h.closed()).toBe(1);
    expect(h.signatureReports()).toBe(1);
  });

  test("the connect button click resolves a gesture and signs", async () => {
    const client = okClient();
    let granted = false;
    const h = mountRuntime(
      {
        openConnected: () => Promise.resolve(granted ? client : null),
        request: () => {
          granted = true;
          return Promise.resolve(client);
        },
      },
      [PENDING],
    );
    await h.poll();
    await tick();

    // Connect state is showing with a live button.
    expect(h.mount.hidden).toBe(false);
    expect(h.mount.querySelector("[data-ledger-connect]")).not.toBeNull();

    click(h.mount, "[data-ledger-connect]");
    await tick();
    expect(h.reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
    expect(h.mount.hidden).toBe(true);
  });

  test("multiple connected devices render a chooser and the selected id is opened", async () => {
    let openedId: string | undefined;
    const h = mountRuntime(
      {
        listConnected: () =>
          Promise.resolve([
            { id: "first", label: "Ledger Nano X 1" },
            { id: "second", label: "Ledger Nano X 2" },
          ]),
        openConnected: (deviceId) => {
          openedId = deviceId;
          return Promise.resolve(okClient());
        },
        request: () => Promise.reject(new Error("no picker expected")),
      },
      [PENDING],
    );
    await h.poll();
    await tick();

    expect(h.mount.textContent).toContain("Choose your Ledger");
    expect(h.mount.querySelector('[data-ledger-device="second"]')).not.toBeNull();
    expect(openedId).toBeUndefined();

    click(h.mount, '[data-ledger-device="second"]');
    await tick();
    expect(openedId).toBe("second");
    expect(h.reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
  });

  test("the cancel button reports a clean rejection", async () => {
    const h = mountRuntime(
      { openConnected: () => Promise.resolve(null), request: () => Promise.reject(new Error("x")) },
      [PENDING],
    );
    await h.poll();
    await tick();

    click(h.mount, "[data-ledger-cancel]");
    await tick();
    expect(h.reports).toEqual([{ error: "rejected-on-device", id: "ledger-sign-1" }]);
    expect(h.mount.hidden).toBe(true);
    expect(h.signatureReports()).toBe(0);
  });

  test("the retry button re-drives the device after a recoverable error", async () => {
    let attempt = 0;
    const client = fakeClient(
      () =>
        Promise.resolve({
          errorMessage: "No errors",
          r: new Uint8Array([...Array(31).fill(0), 1]),
          returnCode: 0x9000,
          s: new Uint8Array([...Array(31).fill(0), 2]),
        }),
      {
        // A locked device surfaces on the pre-check's version read (signHash would
        // swallow the throw), so drive the recoverable error from getAppVersion.
        getAppVersion: () =>
          attempt++ === 0 ? Promise.reject(new Error("device is locked")) : okVersion(),
      },
    );
    const h = mountRuntime(
      {
        openConnected: () => Promise.resolve(client),
        request: () => Promise.reject(new Error("x")),
      },
      [PENDING],
    );
    await h.poll();
    await tick();
    expect(h.mount.querySelector("[data-ledger-retry]")).not.toBeNull();

    click(h.mount, "[data-ledger-retry]");
    await tick();
    expect(h.reports).toEqual([{ id: "ledger-sign-1", r: "0x1", s: "0x2" }]);
  });
});
