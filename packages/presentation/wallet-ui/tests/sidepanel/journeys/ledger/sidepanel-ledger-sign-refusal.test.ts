/**
 * A refused Ledger sign in the side-panel controller (mc-wallet 876). The
 * Starknet app answers a reject and Blind signing being off with the same
 * status, so the panel shows one sentence that covers both and claims neither.
 * A refusal parks the request: the device is asked once, nothing is reported,
 * and only the user's Retry asks again.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import type { LedgerSignRequestSummary } from "../../../../src/popup/responses/responses";
import type { LedgerSignOutcome } from "../../../../src/sidepanel/journeys/ledger/runtime-client";
import {
  createLedgerSignController,
  type LedgerSignView,
} from "../../../../src/sidepanel/journeys/ledger/sign-session";

const COMBINED_COPY =
  "Rejected on your Ledger. If you didn't reject it, turn on Blind signing in the Starknet app settings, then retry.";
const REJECTED_COPY = "You rejected the request on your Ledger. Nothing was submitted.";

const REQUEST: LedgerSignRequestSummary = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  id: "ledger-sign-1",
  messageHash: "0xabc",
  path: ledgerAccountPath(0),
  publicKeyX: "0x2",
};

// X → "0x2", the request's publicKeyX, so the pre-check passes.
const DEVICE_PUBLIC_KEY = Uint8Array.from([...Array(31).fill(0), 0x02, ...Array(32).fill(0xff)]);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const refusingDevice = (returnCode: number) => {
  let signCalls = 0;
  const client: LedgerDeviceClient = {
    getAppVersion: () =>
      Promise.resolve({ errorMessage: "", major: 2, minor: 4, patch: 3, returnCode: 0x9000 }),
    getOsVersion: () => Promise.resolve({ targetId: 0x33000004, version: "2.7.1" }),
    getPubKey: () =>
      Promise.resolve({ errorMessage: "", publicKey: DEVICE_PUBLIC_KEY, returnCode: 0x9000 }),
    signHash: () => {
      signCalls += 1;
      return Promise.resolve({
        errorMessage: "refused",
        r: new Uint8Array(),
        returnCode,
        s: new Uint8Array(),
      });
    },
  };
  return { client, signCalls: () => signCalls };
};

const run = async (returnCode: number) => {
  const device = refusingDevice(returnCode);
  const reports: LedgerSignOutcome[] = [];
  const views: (LedgerSignView | null)[] = [];
  const controller = createLedgerSignController({
    connector: {
      openConnected: () => Promise.resolve({ client: device.client, close: async () => {} }),
      request: () => Promise.reject(new Error("no gesture expected")),
    },
    render: (view) => views.push(view),
    report: (outcome) => {
      reports.push(outcome);
      return Promise.resolve();
    },
  });
  controller.present(REQUEST);
  await tick();
  return { controller, device, reports, views };
};

describe("a refused Ledger sign", () => {
  test("the shared refusal status shows the combined copy, not a claim of either cause", async () => {
    const { views } = await run(0x6f00);
    expect(views.at(-1)?.phase).toEqual({
      code: "rejected-or-blind-signing-off",
      kind: "error",
      message: COMBINED_COPY,
    });
  });

  test("UserRejected keeps the rejection copy", async () => {
    const { views } = await run(0x6e04);
    expect(views.at(-1)?.phase).toEqual({
      code: "rejected-on-device",
      kind: "error",
      message: REJECTED_COPY,
    });
  });

  for (const returnCode of [0x6f00, 0x6e04]) {
    test(`a ${returnCode.toString(16)} refusal is never retried until the user asks`, async () => {
      const { controller, device, reports } = await run(returnCode);
      for (let i = 0; i < 5; i += 1) await tick();
      expect(device.signCalls()).toBe(1);
      // Parked, not reported: the request can still be retried or cancelled.
      expect(reports).toEqual([]);

      controller.retry();
      await tick();
      expect(device.signCalls()).toBe(2);
    });
  }
});
