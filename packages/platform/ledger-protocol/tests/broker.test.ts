/**
 * The hardware-tab protocol rejects arbitrary paths, non-field hashes,
 * unexpected fields, malformed capabilities, and unknown error codes.
 */
import { describe, expect, test } from "bun:test";
import {
  isLedgerBrokerCommand,
  isLedgerBrokerResponse,
  ledgerBrokerChannelName,
  ledgerBrokerSessionFromHash,
} from "@bramble/ledger-protocol/broker";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";

const SESSION_ID = "2db2df18-12db-4d66-9b38-02dc16460ce3";

describe("Ledger broker session capability", () => {
  test("accepts a canonical v4 UUID fragment and derives its isolated channel", () => {
    expect(ledgerBrokerSessionFromHash(`#session=${SESSION_ID}`)).toBe(SESSION_ID);
    expect(ledgerBrokerChannelName(SESSION_ID)).toBe(`bramble-ledger-v1:${SESSION_ID}`);
  });

  test("rejects missing, malformed, and invalidly encoded capabilities", () => {
    expect(ledgerBrokerSessionFromHash("")).toBeNull();
    expect(ledgerBrokerSessionFromHash("#session=shared")).toBeNull();
    expect(ledgerBrokerSessionFromHash("#session=%E0%A4%A")).toBeNull();
  });
});

describe("isLedgerBrokerCommand", () => {
  test("accepts only exact canonical device operations", () => {
    const path = ledgerAccountPath(7);
    expect(isLedgerBrokerCommand({ id: 1, kind: "command", method: "getOsVersion" })).toBe(true);
    expect(isLedgerBrokerCommand({ id: 1, kind: "command", method: "getAppVersion" })).toBe(true);
    expect(isLedgerBrokerCommand({ id: 2, kind: "command", method: "getPubKey", path })).toBe(true);
    expect(
      isLedgerBrokerCommand({
        hash: "0x123",
        id: 3,
        kind: "command",
        method: "signHash",
        path,
      }),
    ).toBe(true);
    expect(isLedgerBrokerCommand({ kind: "close" })).toBe(true);
  });

  test("rejects arbitrary paths, invalid hashes, duplicate ids, and extra fields", () => {
    expect(
      isLedgerBrokerCommand({
        id: 1,
        kind: "command",
        method: "getPubKey",
        path: "m/44'/60'/0'/0/0",
      }),
    ).toBe(false);
    expect(
      isLedgerBrokerCommand({
        hash: "0xnothex",
        id: 2,
        kind: "command",
        method: "signHash",
        path: ledgerAccountPath(0),
      }),
    ).toBe(false);
    expect(
      isLedgerBrokerCommand({ extra: true, id: 3, kind: "command", method: "getAppVersion" }),
    ).toBe(false);
    expect(isLedgerBrokerCommand({ id: 3, kind: "command", method: "getOsVersion", x: 1 })).toBe(
      false,
    );
    expect(isLedgerBrokerCommand({ id: 0, kind: "command", method: "getAppVersion" })).toBe(false);
  });
});

describe("isLedgerBrokerResponse", () => {
  test("accepts ready, values, and catalogued failures", () => {
    expect(isLedgerBrokerResponse({ kind: "ready" })).toBe(true);
    expect(isLedgerBrokerResponse({ id: 1, kind: "response", ok: true, value: { major: 2 } })).toBe(
      true,
    );
    expect(
      isLedgerBrokerResponse({
        error: "device-locked",
        id: 2,
        kind: "response",
        ok: false,
      }),
    ).toBe(true);
  });

  test("rejects unknown failures and response-shape drift", () => {
    expect(
      isLedgerBrokerResponse({ error: "raw-device-message", id: 1, kind: "response", ok: false }),
    ).toBe(false);
    expect(isLedgerBrokerResponse({ id: 1, kind: "response", ok: true })).toBe(false);
    expect(isLedgerBrokerResponse({ extra: true, kind: "ready" })).toBe(false);
  });
});
