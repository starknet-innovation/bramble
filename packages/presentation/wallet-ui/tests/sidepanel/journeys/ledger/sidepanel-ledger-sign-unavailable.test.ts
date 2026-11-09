/**
 * The Ledger sign controller in a browser that cannot reach a Ledger (Firefox
 * has no WebHID, WebUSB or Web Bluetooth). An existing Ledger account's request
 * shows the browser-support message at once, without touching the connector,
 * and stays parked so Cancel still rejects it cleanly.
 */
import { describe, expect, test } from "bun:test";
import { ledgerMessage } from "@bramble/ledger-protocol/errors";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import type { LedgerSignRequestSummary } from "../../../../src/popup/responses/responses";
import type { LedgerSignOutcome } from "../../../../src/sidepanel/journeys/ledger/runtime-client";
import {
  createLedgerSignController,
  type LedgerConnector,
  type LedgerSignView,
} from "../../../../src/sidepanel/journeys/ledger/sign-session";

const REQUEST: LedgerSignRequestSummary = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  id: "ledger-sign-firefox",
  messageHash: "0xabc",
  path: ledgerAccountPath(0),
  publicKeyX: "0x2",
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const unavailable = (available: boolean | undefined) => {
  const calls: string[] = [];
  const reports: LedgerSignOutcome[] = [];
  const views: (LedgerSignView | null)[] = [];
  const connector: LedgerConnector = {
    ...(available === undefined ? {} : { isAvailable: () => available }),
    listConnected: async () => {
      calls.push("listConnected");
      return [];
    },
    openConnected: async () => {
      calls.push("openConnected");
      return null;
    },
    request: async () => {
      calls.push("request");
      throw new Error("no gesture expected");
    },
  };
  const controller = createLedgerSignController({
    connector,
    render: (view) => views.push(view),
    report: async (outcome) => {
      reports.push(outcome);
    },
  });
  return { calls, controller, reports, views };
};

describe("Ledger sign controller without a Ledger transport", () => {
  test("shows the browser-support message at once and never touches the device", async () => {
    const h = unavailable(false);
    h.controller.present(REQUEST);
    await tick();

    expect(h.views).toEqual([
      {
        phase: {
          code: "webhid-unavailable",
          kind: "error",
          message: ledgerMessage("webhid-unavailable"),
        },
        request: REQUEST,
      },
    ]);
    expect(h.calls).toEqual([]);
    expect(h.reports).toEqual([]);
  });

  test("retry repeats the message, and cancel rejects the parked request", async () => {
    const h = unavailable(false);
    h.controller.present(REQUEST);
    await tick();
    h.controller.retry();
    await tick();
    expect(h.views.map((view) => view?.phase.kind)).toEqual(["error", "error"]);

    await h.controller.cancel();
    expect(h.reports).toEqual([{ error: "rejected-on-device", id: REQUEST.id }]);
    expect(h.calls).toEqual([]);
  });

  test("a connector that does not report availability still discovers devices", async () => {
    const h = unavailable(undefined);
    h.controller.present(REQUEST);
    await tick();
    expect(h.calls).toEqual(["listConnected", "openConnected"]);
    expect(h.views.at(-1)?.phase.kind).toBe("connect");
  });
});
