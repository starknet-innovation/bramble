/**
 * The device signed and the wallet's half failed (errors audit F9). That is
 * not a device fault, and the transaction may be on its way, so the prompt
 * says signing didn't finish and points at Activity.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import type { LedgerSignOutcome } from "../../../../src/sidepanel/journeys/ledger/runtime-client";
import { createLedgerSignRuntime } from "../../../../src/sidepanel/journeys/ledger/sign-runtime";
import {
  createLedgerSignController,
  type LedgerSignView,
} from "../../../../src/sidepanel/journeys/ledger/sign-session";
import { ledgerSignScreen } from "../../../../src/sidepanel/journeys/ledger/sign-views";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { manualTimers } from "../../../support/manual-timers";

beforeAll(registerDom);
afterAll(unregisterDom);

// The device key whose X-coordinate is "0x2", the account's publicKeyX below.
const DEVICE_PUBLIC_KEY = Uint8Array.from([...Array(31).fill(0), 0x02, ...Array(32).fill(0xff)]);
const ok = { errorMessage: "No errors", returnCode: 0x9000 } as const;
const client: LedgerDeviceClient = {
  getAppVersion: () => Promise.resolve({ ...ok, major: 2, minor: 4, patch: 0 }),
  getOsVersion: () => Promise.resolve({ targetId: 0x33000004, version: "2.7.1" }),
  getPubKey: () => Promise.resolve({ ...ok, publicKey: DEVICE_PUBLIC_KEY }),
  signHash: () =>
    Promise.resolve({
      ...ok,
      r: new Uint8Array([...Array(31).fill(0), 1]),
      s: new Uint8Array([...Array(31).fill(0), 2]),
    }),
};

test("a failed report after the device signed reads as unfinished, never a Ledger fault", async () => {
  const views: (LedgerSignView | null)[] = [];
  let closed = 0;
  const controller = createLedgerSignController({
    connector: {
      openConnected: () =>
        Promise.resolve({
          client,
          close: () => {
            closed += 1;
            return Promise.resolve();
          },
        }),
      request: () => Promise.reject(new Error("unused")),
    },
    render: (view) => views.push(view),
    report: () => Promise.reject(new Error("vault storage limit reached")),
  });
  controller.present({
    accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
    id: "ledger-sign-1",
    messageHash: "0xabc",
    path: ledgerAccountPath(0),
    publicKeyX: "0x2",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(views.at(-1)?.phase).toEqual({
    code: null,
    kind: "error",
    message: "Signing on your Ledger didn't finish. Check Activity before trying again.",
  });
  // The transport is still released.
  expect(closed).toBe(1);
});

const REQUEST = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  id: "ledger-sign-1",
  messageHash: "0xabc",
  path: ledgerAccountPath(0),
  publicKeyX: "0x2",
};
const UNFINISHED = "Signing on your Ledger didn't finish. Check Activity before trying again.";
const STATUS = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
} as const;

// Audit N4: the screen says to check Activity before trying again, so it must
// not offer a re-sign; and Cancel would report a device rejection the device
// never gave. Close is the only control.
test("the unfinished view offers Close only", () => {
  const html = ledgerSignScreen(
    { phase: { code: null, kind: "error", message: UNFINISHED }, request: REQUEST },
    STATUS,
  );
  expect(html).toContain("data-ledger-close");
  expect(html).toContain(">Close<");
  expect(html).not.toContain("data-ledger-retry");
  expect(html).not.toContain("Try again");
  expect(html).not.toContain("data-ledger-cancel");
  // A device error keeps both of its controls.
  const device = ledgerSignScreen(
    { phase: { code: "device-locked", kind: "error", message: "x" }, request: REQUEST },
    STATUS,
  );
  expect(device).toContain("data-ledger-retry");
  expect(device).toContain("data-ledger-cancel");
  expect(device).not.toContain("data-ledger-close");
});

test("Close takes the prompt down, reports nothing, and is not re-offered by a poll", async () => {
  document.body.replaceChildren();
  const mount = document.createElement("div");
  mount.hidden = true;
  document.body.append(mount);
  const reports: LedgerSignOutcome[] = [];
  let signs = 0;
  const timers = manualTimers();
  const runtime = createLedgerSignRuntime({
    connector: {
      openConnected: () =>
        Promise.resolve({
          client: {
            ...client,
            signHash: (...args) => {
              signs += 1;
              return client.signHash(...args);
            },
          },
          close: () => Promise.resolve(),
        }),
      request: () => Promise.reject(new Error("unused")),
    },
    mount,
    status: () => STATUS,
    timers,
    wallet: {
      completeLedgerSign: (outcome) => {
        reports.push(outcome);
        return Promise.reject(new Error("vault storage limit reached"));
      },
      // The background still holds the request after the failed report.
      loadLedgerSignPending: () => Promise.resolve([REQUEST]),
    },
  });
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    timers.flush();
  };
  await runtime.poll();
  await settle();
  expect(mount.hidden).toBe(false);
  expect(mount.textContent).toContain("didn't finish");
  expect(mount.querySelector("[data-ledger-retry]")).toBeNull();

  mount
    .querySelector<HTMLButtonElement>("[data-ledger-close]")
    ?.dispatchEvent(new window.Event("click", { bubbles: true }));
  await settle();
  expect(mount.hidden).toBe(true);

  await runtime.poll();
  await settle();
  expect(mount.hidden).toBe(true);
  expect(signs).toBe(1);
  // Only the signature itself was reported: no rejection was sent for it.
  expect(reports.map((outcome) => ("error" in outcome ? outcome.error : "signature"))).toEqual([
    "signature",
  ]);
});
