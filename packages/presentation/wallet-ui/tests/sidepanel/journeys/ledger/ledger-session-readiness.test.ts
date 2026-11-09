/**
 * A grant-tab probe verifies one exact live transport before handing it to the
 * side panel. These tests ensure consumers reuse that bounded result instead of
 * cycling dashboard -> Starknet a second time, while retaining the mandatory
 * account-key check and device signature operation.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import type { LedgerSignRequestSummary } from "../../../../src/popup/responses/responses";
import { enumerateLedgerPubKeys } from "../../../../src/sidepanel/journeys/ledger/onboard-session";
import {
  createLedgerSignController,
  type LedgerConnector,
} from "../../../../src/sidepanel/journeys/ledger/sign-session";

const PUBLIC_KEY = Uint8Array.from([...Array(31).fill(0), 2, ...Array(32).fill(0)]);

const verifiedClient = (compatibilityRead: () => never): LedgerDeviceClient => ({
  getAppVersion: async () => compatibilityRead(),
  getOsVersion: async () => compatibilityRead(),
  getPubKey: async () => ({
    errorMessage: "No errors",
    publicKey: PUBLIC_KEY,
    returnCode: 0x9000,
  }),
  signHash: async () => ({
    errorMessage: "No errors",
    r: Uint8Array.from([...Array(31).fill(0), 1]),
    returnCode: 0x9000,
    s: Uint8Array.from([...Array(31).fill(0), 2]),
  }),
});

describe("verified Ledger session reuse", () => {
  test("enumeration skips only the repeated OS and app compatibility probe", async () => {
    let compatibilityReads = 0;
    const entries = await enumerateLedgerPubKeys(
      verifiedClient(() => {
        compatibilityReads += 1;
        throw new Error("compatibility probe repeated");
      }),
      0,
      1,
      "verified",
    );

    expect(compatibilityReads).toBe(0);
    expect(entries).toEqual([{ accountIndex: 0, publicKeyX: "0x2" }]);
  });

  test("signing still matches the account key and obtains a device signature", async () => {
    let compatibilityReads = 0;
    let closed = 0;
    const connector: LedgerConnector = {
      openConnected: () =>
        Promise.resolve({
          client: verifiedClient(() => {
            compatibilityReads += 1;
            throw new Error("compatibility probe repeated");
          }),
          close: () => {
            closed += 1;
            return Promise.resolve();
          },
          readiness: "verified",
        }),
      request: () => Promise.reject(new Error("unused")),
    };
    const reports: unknown[] = [];
    const controller = createLedgerSignController({
      connector,
      render: () => undefined,
      report: (outcome) => {
        reports.push(outcome);
        return Promise.resolve();
      },
    });
    const request: LedgerSignRequestSummary = {
      accountId: "SN_MAIN:0x123",
      id: "ledger-sign-verified-session",
      messageHash: "0xabc",
      path: ledgerAccountPath(0),
      publicKeyX: "0x2",
    };

    controller.present(request);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(compatibilityReads).toBe(0);
    expect(closed).toBe(1);
    expect(reports).toEqual([{ id: "ledger-sign-verified-session", r: "0x1", s: "0x2" }]);
  });
});
