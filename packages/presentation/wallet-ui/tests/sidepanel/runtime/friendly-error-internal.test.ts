/**
 * What the side panel shows for the wallet's own error messages (mc-wallet
 * issue 652 and its review). The default is to show a message as written; only
 * reviewed plumbing, listed exactly, is replaced. A Ledger rejection reads as the
 * device catalog says, and a security, privacy, or funds fact keeps its words.
 */
import { describe, expect, test } from "bun:test";
import { ledgerMessage } from "@bramble/ledger-protocol/errors";

import { friendlyError } from "../../../src/sidepanel/runtime/friendly-error";
import {
  FACT_TERMS,
  PLUMBING_DESPITE_FACT_WORD,
  REVIEWED_PLUMBING,
} from "../../../src/sidepanel/runtime/friendly-error-internal";

const GENERIC = "Something went wrong. Please try again.";
const ADD_ACCOUNT = "Couldn't add that account. Try again.";
const STRK20_DOWN = "Private balances are unavailable right now. Try again shortly.";

describe("reviewed plumbing", () => {
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

  test("the issue's named diagnostics are replaced, with the caller's sentence when given", () => {
    for (const raw of named) {
      expect(friendlyError(raw).message).toBe(GENERIC);
      expect(friendlyError(raw, ADD_ACCOUNT).message).toBe(ADD_ACCOUNT);
    }
  });

  test("an unlisted message of a familiar shape is shown as written", () => {
    for (const raw of [
      "Invalid origin",
      "Invalid nonce",
      "Invalid chainId",
      "Invalid prepared Argent multisig transaction",
      "Unsupported vault schema",
      "Unlock session expired",
      "Krusty KMS returned invalid public key",
      "Krusty KMS signature verification failed",
      "Starkscan flagged a scam token",
      "RPC returned a replayed transaction",
      "Krusty KMS result missing non-zero private key: account",
      "Krusty KMS result missing field element: public_key_x",
    ]) {
      expect(friendlyError(raw).message).toBe(raw);
      expect(friendlyError(raw, ADD_ACCOUNT).message).toBe(raw);
    }
  });

  test("no listed entry names a fact unless its reason is recorded", () => {
    const unexplained = [...REVIEWED_PLUMBING.keys()].filter(
      (raw) => FACT_TERMS.test(raw) && !PLUMBING_DESPITE_FACT_WORD.has(raw),
    );
    expect(unexplained).toEqual([]);
    for (const raw of PLUMBING_DESPITE_FACT_WORD) expect(REVIEWED_PLUMBING.has(raw)).toBe(true);
  });

  test("the reader's own input maps to the sentences the wallet already uses", () => {
    expect(friendlyError("Invalid recovery phrase").message).toBe(
      "Couldn't import that recovery phrase. Check the words and try again.",
    );
    expect(friendlyError("Invalid mnemonic").message).toBe(
      "Couldn't import that recovery phrase. Check the words and try again.",
    );
    expect(friendlyError("Invalid private key").message).toBe(
      "Couldn't import that account. Check what you pasted and try again.",
    );
    expect(friendlyError("Invalid preferences backup").message).toBe(
      "Couldn't read that backup file. Check the file and try again.",
    );
  });
});

describe("Ledger device rejections", () => {
  test("a rejection code reads as the device catalog's own sentence, whatever the context", () => {
    for (const code of ["rejected-on-device", "device-locked", "blind-signing-disabled"] as const) {
      expect(friendlyError(code).message).toBe(ledgerMessage(code));
      expect(friendlyError(code, ADD_ACCOUNT).message).toBe(ledgerMessage(code));
    }
  });
});

describe("STRK20 (review F1, F2)", () => {
  test("an unresolved earlier write keeps its may-be-in-flight fact and the recovery step", () => {
    const raw =
      "strk20 services unavailable: an earlier private transaction from this account may still be in progress";
    expect(friendlyError(raw).message).toBe(
      "An earlier private transaction from this account may still be in progress. Check Activity, then check again. If it stays stuck, open Settings → Unlock private transactions.",
    );
    expect(friendlyError(raw, ADD_ACCOUNT).message).toBe(
      "An earlier private transaction from this account may still be in progress. Check Activity, then check again. If it stays stuck, open Settings → Unlock private transactions.",
    );
  });

  test("an earlier write no check can resolve names the browser restart", () => {
    const raw =
      "strk20 services unavailable: an earlier private transaction from this account may still be in progress, and no check can confirm it";
    expect(friendlyError(raw).message).toBe(
      "An earlier private transaction from this account may still be in progress, and no check can confirm it. To continue anyway, open Settings → Unlock private transactions.",
    );
  });

  test("a revert, rejected proof, failed validation, or nonce stays visible", () => {
    // The fact stays, in the reader's words (copy review bf01-bf05); the shared
    // "services unavailable" head, which would say the services were down when
    // the transaction was refused, does not (errors audit F5).
    for (const [category, shown] of [
      ["execution-reverted", "Starknet rejected the private transaction: reason"],
      ["proof-rejected", "The privacy pool rejected the proof: reason"],
      ["validation-failed", "The private transaction failed validation: reason"],
      // The nonce sentence names the reader's move; the reason stays behind
      // the toast's copy control.
      ["invalid-nonce", "The account's nonce changed. Review the transaction again."],
      ["insufficient-fee", "The fee couldn't be covered: reason"],
    ] as const) {
      const raw = `strk20 services unavailable (submission/${category}): reason`;
      expect(friendlyError(raw).message).toBe(shown);
      expect(friendlyError(raw).message).not.toContain("unavailable");
    }
    // Without a reason the sentence ends there.
    expect(friendlyError("strk20 services unavailable (proving/proof-rejected)").message).toBe(
      "The privacy pool rejected the proof.",
    );
    // A category with no reviewed sentence keeps its words without the head.
    expect(friendlyError("strk20 services unavailable (submission/other): reason").message).toBe(
      "strk20 submission/other: reason",
    );
    expect(friendlyError("strk20 services unavailable (submission/constructor): x").message).toBe(
      "strk20 submission/constructor: x",
    );
    // The SDK's catch-all names no outage and keeps its words.
    const unclassified = "strk20 services unavailable (submission/service-unavailable): reason";
    expect(friendlyError(unclassified).message).toBe(unclassified);
    // Every budgeted phase (discovery, maturity, proof request, proving) runs
    // before anything is sent, so outcome-unknown copy would misstate it (R2-4).
    for (const phase of [
      "discovering private notes",
      "waiting for pool maturity",
      "building the proof request",
      "proving",
    ]) {
      const timedOut = `strk20 services unavailable: ${phase} did not finish within 60 s`;
      expect(friendlyError(timedOut).message).toBe(timedOut);
    }
  });

  test("only the services-down reasons read as unavailable", () => {
    for (const raw of [
      "strk20 services unavailable",
      "strk20 services unavailable: no RPC endpoint is configured",
      "strk20 services unavailable: no privacy routing is configured for this network",
      "strk20 services unavailable: could not read the pool fee (timeout)",
    ]) {
      expect(friendlyError(raw).message).toBe(STRK20_DOWN);
    }
    expect(friendlyError("strk20 services unavailable (rate limited; retry shortly)").message).toBe(
      "This service is rate limiting requests. Wait a moment and try again.",
    );
  });

  test("a privacy service's 5xx outage reads as unavailable, never the raw text (mc-wallet 723)", () => {
    for (const raw of [
      'strk20 services unavailable: Indexer API /v1/sync/preflight_check failed (502): {"error":"upstream_unavailable"}',
      "strk20 services unavailable: Indexer API /v1/sync/incoming_state failed (503)",
      "strk20 services unavailable: Indexer API /v1/history failed (504): gateway timeout",
      'strk20 services unavailable: Indexer API /v1/sync/outgoing_state failed (500): {"error":"upstream_unavailable"}',
    ]) {
      expect(friendlyError(raw).message).toBe(STRK20_DOWN);
    }
  });

  test("a privacy service's 4xx refusal and other causes keep their words", () => {
    for (const raw of [
      'strk20 services unavailable: Indexer API /v1/sync/preflight_check failed (400): {"error":"bad_request"}',
      "strk20 services unavailable: Indexer API /v1/history failed (404)",
      "strk20 services unavailable: Indexer API /v1/history failed (501)",
      "strk20 services unavailable: Indexer API /v1/history failed (5020)",
      "strk20 services unavailable: unexpected discovery response shape",
    ]) {
      expect(friendlyError(raw).message).toBe(raw);
    }
  });

  test("a privacy-leak refusal says so, in every form, never 'may not have gone through'", () => {
    for (const raw of [
      "strk20 privacy leak",
      "strk20 privacy leak: USER_LINKAGE",
      "strk20 privacy leak (proving/service-unavailable): USER_LINKAGE",
    ]) {
      expect(friendlyError(raw).message).toBe("The operation would leak private information");
      expect(friendlyError(raw, "Private transaction failed").message).toBe(
        "The operation would leak private information",
      );
    }
  });

  test("other STRK20 and private-balance refusals keep their words", () => {
    for (const raw of [
      "strk20 relay fee exceeds the reviewed ceiling",
      "strk20 private submission unavailable",
      "strk20 converted fee could not be verified independently",
      "private balance overflow",
    ]) {
      expect(friendlyError(raw).message).toBe(raw);
    }
  });
});

describe("the lowercase backstop", () => {
  test("still replaces noise, but never a lowercase fact", () => {
    expect(friendlyError("boom").message).toBe(GENERIC);
    expect(friendlyError("signature verification failed").message).toBe(
      "signature verification failed",
    );
    expect(friendlyError("approval summary too long to review").message).toBe(
      "approval summary too long to review",
    );
  });

  test("keeps the revoke safety refusal's fact", () => {
    const raw =
      "this wallet could not confirm that contract is a token, so it will not send a revoke that could approve an NFT instead; revoke it from the dapp";
    expect(friendlyError(raw).message).toBe(
      "Couldn't confirm that contract is a token, so the revoke wasn't sent. Revoke it from the site that asked.",
    );
  });
});

describe("status lines (errorLine)", () => {
  test("never borrow a 'may not have gone through' fallback for a refusal or noise", async () => {
    const { errorLine } = await import("../../../src/sidepanel/shared/dom");
    expect(errorLine(new Error("strk20 privacy leak"), "Private transaction failed")).toBe(
      "The operation would leak private information",
    );
    expect(errorLine(new Error("boom"), "Private transaction failed")).toBe(GENERIC);
    // The swap review line names the safety check that stopped the build (R2-1).
    expect(
      errorLine(
        new Error("swap build routed the proceeds to another account"),
        "Could not prepare a safe swap route.",
      ),
    ).toBe("swap build routed the proceeds to another account");
    // The fallback is still translated when nothing was thrown.
    expect(errorLine(null, "Private transaction failed")).toContain("may not have gone through");
  });
});

// Errors audit F5: the STRK20 branch ran before the rate-limit and network
// classifiers, so those categories reached the reader raw.
describe("STRK20 categories with a reviewed sentence", () => {
  test("a rate limit and a transport failure read as their sentence, detail kept", () => {
    expect(
      friendlyError("strk20 services unavailable (submission/rate-limited): -32005 slow down")
        .message,
    ).toBe(
      "This service is rate limiting requests. Wait a moment and try again. (-32005 slow down)",
    );
    expect(
      friendlyError("strk20 services unavailable (submission/transport): Failed to fetch").message,
    ).toBe("Couldn't reach the network. Check your connection or RPC endpoint. (Failed to fetch)");
    expect(friendlyError("strk20 services unavailable (proving/transport)").message).toBe(
      "Couldn't reach the network. Check your connection or RPC endpoint.",
    );
    expect(friendlyError("strk20 services unavailable: HTTP 429 too many requests").message).toBe(
      "This service is rate limiting requests. Wait a moment and try again. (HTTP 429 too many requests)",
    );
    expect(friendlyError("strk20 services unavailable: fetch failed").message).toBe(
      "Couldn't reach the network. Check your connection or RPC endpoint. (fetch failed)",
    );
  });

  test("a revert reads as a revert, with its reason", () => {
    const raw =
      "strk20 services unavailable (submission/execution-reverted): Error in the called contract (0x1): ENTRYPOINT_FAILED";
    expect(friendlyError(raw).message).toBe(
      "Starknet rejected the private transaction: Error in the called contract (0x1): ENTRYPOINT_FAILED",
    );
  });

  test("an unknown submission status and a privacy-leak refusal keep their words", () => {
    const unknown =
      "strk20 services unavailable: an earlier private transaction from this account may still be in progress";
    expect(friendlyError(unknown).message).toBe(
      "An earlier private transaction from this account may still be in progress. Check Activity, then check again. If it stays stuck, open Settings → Unlock private transactions.",
    );
    expect(
      friendlyError("strk20 privacy leak (proving/service-unavailable): USER_LINKAGE").message,
    ).toBe("The operation would leak private information");
  });
});

// Errors audit F7: the panel says what a site's private request already says.
test("a network without a shadow-account anonymizer reads as the approved notice", () => {
  expect(
    friendlyError(
      "strk20 services unavailable: no shadow account anonymizer is configured for this network",
    ).message,
  ).toBe("Private services aren't set up for this network.");
});

// Errors audit F10: unreadable stored settings persist across retries, so the
// reader is never told to try again.
test("unreadable stored settings are not told to try again", () => {
  const shown = "Couldn't read your saved settings. Restore them from a backup.";
  expect(friendlyError("Invalid stored preferences").message).toBe(shown);
  expect(
    friendlyError("Invalid stored preferences", "Couldn't add that account. Try again.").message,
  ).toBe(shown);
});

// The RPC refusal is known not to have been submitted; its sentence keeps that
// fact, which the generic rate-limit line dropped (copy review bf06).
test("an endpoint refusal says nothing was submitted", async () => {
  const { RPC_REFUSED_MESSAGE } = await import("@bramble/starknet/rpc-transport");
  expect(friendlyError(RPC_REFUSED_MESSAGE).message).toBe(
    "The RPC endpoint refused this request (rate limit or gateway). Nothing was submitted. Wait a moment and try again.",
  );
  expect(friendlyError("429 Too Many Requests").message).toBe(
    "This service is rate limiting requests. Wait a moment and try again.",
  );
});
