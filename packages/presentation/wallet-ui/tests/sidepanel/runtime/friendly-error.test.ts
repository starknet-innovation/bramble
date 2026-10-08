/**
 * Tests for the raw-to-friendly error mapping that drives side-panel error
 * toasts and their copy-to-clipboard affordance.
 */
import { describe, expect, test } from "bun:test";
import { WRONG_CHAIN_MESSAGE } from "@bramble/starknet/provider";

import { friendlyError } from "../../../src/sidepanel/runtime/friendly-error";

describe("friendlyError", () => {
  test("rewrites 'invalid <...> request' validation strings", () => {
    for (const raw of [
      "invalid transfer review request",
      "invalid balances request",
      "invalid unlock request",
    ]) {
      const result = friendlyError(raw);
      expect(result.message).not.toBe(raw);
      expect(result.message).not.toContain("invalid");
    }
  });

  // A broken class-hash answer can surface on any family's live check, so its
  // copy names neither Argent nor Braavos.
  test("reads an invalid class-hash answer as an unreadable account", () => {
    expect(friendlyError("RPC returned an invalid account class hash").message).toBe(
      "Couldn't read this account. Try again.",
    );
  });

  // The raw string names neither cause nor remedy, so the mapping supplies the
  // fix — and stays network-agnostic, since the guard fires on every network.
  test("turns the write-path chain guard into an actionable endpoint hint", () => {
    const result = friendlyError(WRONG_CHAIN_MESSAGE);
    expect(result.message).toContain("nothing was submitted");
    expect(result.message).toContain("Advanced");
    expect(result.message).not.toContain("Devnet");
  });

  // The exact strings argent-recovery.ts and account-recovery.ts throw.
  test("maps the recovery refusals to reviewed copy", () => {
    for (const [raw, message] of [
      [
        "This account has a backup guardian, so the guardian cannot be removed with the recovery phrase",
        "This account has a backup guardian, so the recovery phrase can't remove its guardian.",
      ],
      [
        "Could not check this account's backup guardian",
        "Couldn't check this account's backup guardian. Try again.",
      ],
      [
        "Account recovery is not available for Ledger accounts",
        "Removing 2FA or a guardian isn't available for Ledger accounts.",
      ],
      [
        "The active account changed. Review the recovery again.",
        "You switched accounts. Review the recovery again.",
      ],
      [
        "This account allows one escape attempt every 12 hours",
        "This account allows one escape attempt every 12 hours. Try again later.",
      ],
      [
        "Could not check this account's escape limit",
        "Couldn't check this account's escape limit. Try again.",
      ],
      [
        "second factor removal unavailable",
        "Couldn't load 2FA or guardian removal. Check your connection and try again.",
      ],
      [
        "second factor removal unconfirmed",
        "Couldn't confirm the 2FA or guardian removal. Check activity before trying again.",
      ],
      [
        "Deployed Argent account class is not one this wallet can recover",
        "This account runs a Ready release this wallet can't recover. Use it in Ready.",
      ],
      [
        "This account's signer setup cannot be recovered with the recovery phrase",
        "This account's signers can't be recovered with the recovery phrase.",
      ],
      [
        "The account reported an unrecognised escape",
        "This account reported a guardian state this wallet can't read. Use it in Ready.",
      ],
    ] as const) {
      expect(friendlyError(raw).message).toBe(message);
    }
    // The account-discovery flow keeps its own wording.
    expect(friendlyError("account recovery unavailable").message).toBe(
      "Couldn't recover accounts. Check your connection and try again.",
    );
  });

  test("maps 'wallet unavailable' to a friendly message", () => {
    const result = friendlyError("wallet unavailable");
    expect(result).toEqual({
      message: "The wallet is locked or unavailable. Unlock it and try again.",
    });
  });

  test("maps platform network rejections to a friendly message", () => {
    for (const raw of ["Failed to fetch", "NetworkError", "Load failed", "network error"]) {
      const result = friendlyError(raw);
      expect(result.message).toContain("Couldn't reach the network");
    }
  });

  test("matches known strings case-insensitively and ignores surrounding whitespace", () => {
    const result = friendlyError("  Wallet Unavailable  ");
    expect(result.message).toBe("The wallet is locked or unavailable. Unlock it and try again.");
  });

  // The backstop. Curated copy starts with a capital, so an unmapped sentence
  // is someone's writing and survives; an unmapped lowercase string is a
  // diagnostic that reached here by accident and must not reach a reader.
  test("keeps an unrecognized sentence, and refuses an unrecognized diagnostic", () => {
    const sentence = "The prover returned an answer this build does not know.";
    expect(friendlyError(sentence)).toEqual({ message: sentence });

    expect(friendlyError("krusty kms handshake failed: 0x1f timeout").message).toBe(
      "Something went wrong. Please try again.",
    );
  });

  test("collapses raw RPC and API diagnostics to short recovery copy", () => {
    expect(
      friendlyError(
        'RPC: starknet_addInvokeTransaction with params {"calldata":["0x1"]} 55: rejected',
      ).message,
    ).toBe("The RPC rejected this request. Copy the error details for the full response.");
    expect(friendlyError(`Gateway rejected\n${"response body ".repeat(30)}`).message).toBe(
      "A wallet service rejected this request. Copy the error details for the full response.",
    );
    expect(friendlyError('HTTP 400 response body: {"error":"invalid payload"}').message).toBe(
      "A wallet service rejected this request. Copy the error details for the full response.",
    );
    expect(friendlyError("HTTP 429: rate_limited").message).toBe(
      "This service is rate limiting requests. Wait a moment and try again.",
    );
    for (const raw of [
      "24: Block not found: undefined",
      "55: Account validation failed: Resource bounds were not satisfied",
      "Transaction execution error: contract reverted",
    ]) {
      expect(friendlyError(raw).message).toBe(
        "The RPC rejected this request. Copy the error details for the full response.",
      );
    }
  });

  // This one was deferred through four passes because collapsing it to a
  // generic message would have cost a signer the one thing they could act on.
  // It is translated now, so it keeps the fact and loses the vocabulary.
  test("translates a wallet-domain error without losing what it told a signer", () => {
    expect(friendlyError("Argent multisig intent nonce is no longer current").message).toBe(
      "This transaction is out of date. Create a new one.",
    );
    expect(friendlyError("Argent multisig threshold is not satisfied").message).toBe(
      "Not enough signatures yet.",
    );
  });

  // The defect this mapping exists to fix: a raw diagnostic reaching a toast.
  test("no longer shows developer-voice diagnostics to the reader", () => {
    for (const raw of [
      "add token failed",
      "explorer fallback update failed",
      "token detection failed",
      "privacy service configuration failed",
      "wallet lock incomplete",
    ]) {
      const { message } = friendlyError(raw);
      expect(message).not.toBe(raw);
      expect(message[0]).toBe(message[0]?.toUpperCase() ?? "");
    }
  });

  // Where two failures leave the reader the same move, they get the same
  // sentence. A dozen phrasings of "try again" is the drift this guards.
  test("shares one sentence across a family the reader cannot tell apart", () => {
    const saves = [
      "display update failed",
      "label update failed",
      "rpc endpoint update failed",
      "explorer fallback update failed",
      "token visibility update failed",
    ].map((raw) => friendlyError(raw).message);
    expect(new Set(saves).size).toBe(1);

    const routes = [
      "swap build returned no swap call",
      "swap build returned too many calls",
      "swap build returned more than one swap call",
      "swap build returned a route the wallet could not decode",
    ].map((raw) => friendlyError(raw).message);
    expect(new Set(routes).size).toBe(1);
  });

  // The code says group, the UI says folder. The error layer follows the UI.
  test("calls an account group a folder", () => {
    expect(friendlyError("group create failed").message).toContain("folder");
    expect(friendlyError("group remove failed").message).toContain("folder");
    expect(friendlyError("group membership update failed").message).not.toContain("group");
  });

  // These catch-alls wrap a submission whose outcome the wallet doesn't know.
  // Saying it failed and inviting a retry could send the transaction twice.
  test("submission catch-alls never claim failure or invite a blind retry", () => {
    for (const raw of [
      "transfer failed",
      "swap failed",
      "nft transfer failed",
      "private transaction failed",
      "deployment failed",
      "deploy ready multisig failed",
      "approval execution failed",
      "wallet request failed",
      "complete ledger sign failed",
      "no pending ledger sign for id",
    ]) {
      const { message } = friendlyError(raw);
      expect(message).not.toContain("didn't go through");
      expect(message).not.toContain("expired");
      expect(message.toLowerCase()).toContain("check activity");
    }
  });

  test("falls back to a generic message for empty input", () => {
    const result = friendlyError("   ");
    expect(result.message).toBe("Something went wrong. Please try again.");
  });
});
