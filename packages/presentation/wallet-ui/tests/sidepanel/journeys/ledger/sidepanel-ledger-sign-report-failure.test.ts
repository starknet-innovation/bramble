/**
 * The device signed and the wallet's half failed (errors audit F9). That is
 * not a device fault, and the transaction may be on its way, so the prompt
 * says signing didn't finish and points at Activity.
 */
import { expect, test } from "bun:test";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import {
  createLedgerSignController,
  type LedgerSignView,
} from "../../../../src/sidepanel/journeys/ledger/sign-session";

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
