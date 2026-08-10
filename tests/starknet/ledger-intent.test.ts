/**
 * The signing-intent boundary guard. A Ledger blind-signs a bare hash, so the
 * intent is the only description of the operation the user sees — an unknown or
 * malformed one must be rejected at the boundary rather than rendered as an
 * unlabelled prompt. Pure: no device, clock, or storage.
 */
import { describe, expect, test } from "bun:test";
import { isLedgerSignIntent, type LedgerSignIntent } from "../../src/starknet/ledger-intent";

describe("isLedgerSignIntent", () => {
  test("accepts every member of the union", () => {
    // Listed literally rather than derived from the module: this is the catalog a
    // reviewer reads to see which operations can prompt a device, and it fails
    // to type-check if a union member is missing from it.
    const intents: readonly LedgerSignIntent[] = [
      "dapp-message",
      "dapp-transaction",
      "declare-class",
      "deploy-account",
      "multisig-confirm",
      "multisig-deploy",
      "multisig-execute",
      "multisig-propose",
      "multisig-revoke",
      "revoke-spending",
      "send-collectible",
      "send-token",
      "strk20-authorize",
      "strk20-broadcast",
      "strk20-register",
      "swap-tokens",
    ];
    for (const intent of intents) {
      expect(isLedgerSignIntent(intent)).toBe(true);
    }
    expect(new Set(intents).size).toBe(intents.length);
  });

  test("rejects unknown, malformed, and non-string values", () => {
    expect(isLedgerSignIntent("send-everything")).toBe(false);
    expect(isLedgerSignIntent("SEND-TOKEN")).toBe(false);
    expect(isLedgerSignIntent("")).toBe(false);
    expect(isLedgerSignIntent(undefined)).toBe(false);
    expect(isLedgerSignIntent(null)).toBe(false);
    expect(isLedgerSignIntent(0)).toBe(false);
    expect(isLedgerSignIntent({ intent: "send-token" })).toBe(false);
  });

  test("does not admit inherited Object property names", () => {
    // The guard is a membership test over a plain record, so a prototype key
    // must not pass as an intent and reach the copy map as a function.
    expect(isLedgerSignIntent("toString")).toBe(false);
    expect(isLedgerSignIntent("constructor")).toBe(false);
    expect(isLedgerSignIntent("hasOwnProperty")).toBe(false);
  });
});
