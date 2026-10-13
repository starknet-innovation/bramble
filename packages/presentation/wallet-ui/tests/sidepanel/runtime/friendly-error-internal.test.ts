/**
 * The line between the wallet's own plumbing errors and the facts a reader
 * must still be told (mc-wallet issue 652). Plumbing never reaches a reader in
 * its own words; a Ledger rejection reads as the device catalog says; a failed
 * key, signature, hash, chain-id, or pinned-class check keeps saying what
 * failed.
 */
import { describe, expect, test } from "bun:test";
import { ledgerMessage } from "@bramble/ledger-protocol/errors";

import { friendlyError } from "../../../src/sidepanel/runtime/friendly-error";
import {
  FACT_KEPT,
  INTERNAL_DIAGNOSTICS,
  isInternalDiagnostic,
} from "../../../src/sidepanel/runtime/friendly-error-internal";

const GENERIC = "Something went wrong. Please try again.";
const ADD_ACCOUNT = "Couldn't add that account. Try again.";

describe("friendlyError — the wallet's own plumbing", () => {
  // The strings issue 652 names, as the background throws them.
  const named = [
    "Invalid Ledger account index",
    "Invalid Ledger path application",
    "Invalid Starknet network",
    "Invalid account class hash",
    "Invalid account deployment salt",
    "Account class hash does not belong to its account family",
    "Krusty KMS returned invalid class hash JSON",
    "Krusty KMS returned an invalid class hash",
    "Krusty KMS class hashes are missing oz accounts",
    "Krusty KMS class hashes are missing SN_SEPOLIA",
    "Devnet account class hash is invalid",
    "Invalid vault",
    "Unlock session changed during vault creation",
    "Unlock session changed during network switch",
    "Unlock session mirror not revoked",
  ];

  test("is never shown as written", () => {
    for (const raw of named) {
      expect(friendlyError(raw).message).toBe(GENERIC);
    }
  });

  test("takes the calling screen's sentence when it gives one", () => {
    for (const raw of named) {
      expect(friendlyError(raw, ADD_ACCOUNT).message).toBe(ADD_ACCOUNT);
    }
  });

  test("an unreviewed string of an internal family is collapsed too", () => {
    expect(friendlyError("Krusty KMS export missing: derive_account").message).toBe(GENERIC);
    expect(friendlyError("Invalid Starkscan page limit").message).toBe(GENERIC);
    expect(friendlyError("Unlock session changed during something new").message).toBe(GENERIC);
  });

  test("keeps a reader's own sentence and an actionable state as written", () => {
    for (const raw of [
      "Account already exists",
      "Wallet already exists",
      "Enter a secure HTTPS service URL",
      "Nostr coordination requires a recovery-phrase wallet",
    ]) {
      expect(friendlyError(raw).message).toBe(raw);
    }
  });

  test("maps a pasted phrase or key the reader can fix to the import sentences", () => {
    expect(friendlyError("Invalid mnemonic").message).toBe(
      "Couldn't import that recovery phrase. Check the words and try again.",
    );
    expect(friendlyError("Invalid private key").message).toBe(
      "Couldn't import that account. Check what you pasted and try again.",
    );
  });

  test("keeps the unrecognised-class fact for a Ledger Braavos or Argent account", () => {
    expect(friendlyError("Invalid Braavos account class hash").message).toContain(
      "release this wallet doesn't recognize",
    );
    expect(friendlyError("Invalid Argent account class hash").message).toContain(
      "release this wallet doesn't recognize",
    );
  });
});

describe("friendlyError — Ledger device rejections", () => {
  test("a rejection code reads as the device catalog's own sentence", () => {
    for (const code of ["rejected-on-device", "device-locked", "blind-signing-disabled"] as const) {
      expect(friendlyError(code).message).toBe(ledgerMessage(code));
      expect(friendlyError(code, ADD_ACCOUNT).message).toBe(ledgerMessage(code));
    }
  });
});

describe("friendlyError — security and cryptographic facts", () => {
  test("every reviewed fact is shown with its words, even with a context sentence", () => {
    for (const fact of FACT_KEPT) {
      const message = friendlyError(fact).message;
      expect(message.toLowerCase()).toBe(fact);
      expect(friendlyError(fact, ADD_ACCOUNT).message.toLowerCase()).toBe(fact);
    }
  });

  test("an unreviewed family string naming a failed check is not collapsed", () => {
    for (const raw of [
      "Invalid signature from the account",
      "Krusty KMS signature verification failed",
      "Unlock session chain id does not match",
    ]) {
      expect(friendlyError(raw).message).toBe(raw);
    }
  });

  test("a lowercase diagnostic naming a failed check keeps its words", () => {
    expect(friendlyError("signature verification failed").message).toBe(
      "signature verification failed",
    );
    expect(friendlyError("boom").message).toBe(GENERIC);
  });

  test("keeps the revoke safety refusal's fact rather than a generic sentence", () => {
    const raw =
      "this wallet could not confirm that contract is a token, so it will not send a revoke that could approve an NFT instead; revoke it from the dapp";
    expect(friendlyError(raw).message).toContain("could not confirm that contract is a token");
  });
});

describe("the reviewed lists", () => {
  test("do not overlap", () => {
    expect([...FACT_KEPT].filter((raw) => INTERNAL_DIAGNOSTICS.has(raw))).toEqual([]);
  });

  test("an explicitly internal diagnostic is collapsed despite naming a fact word", () => {
    for (const raw of INTERNAL_DIAGNOSTICS) {
      expect(isInternalDiagnostic(raw)).toBe(true);
    }
  });
});
