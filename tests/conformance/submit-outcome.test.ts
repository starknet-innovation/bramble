/**
 * What a rejected Send or swap may claim about whether anything was sent
 * (errors audit F1, F2).
 *
 * "Not sent" is said only for the closed `KNOWN_NOT_SENT` set; every other
 * rejection reads as outcome unknown. This walks every message the wallet's
 * own code mints and requires that the list is live, that a message which
 * itself says nothing was submitted is on it, and that no composed sentence
 * claims both outcomes at once.
 */
import { describe, expect, test } from "bun:test";
import { INVOKE_NOT_JOURNALED, REVIEWED_FEE_REQUIRED } from "@bramble/starknet/rpc-submit";
import {
  PRIVACY_PUBLIC_BALANCE_UNCONFIRMED,
  privacyShortfall,
} from "@bramble/wallet-protocol/privacy-blocker";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { friendlyError } from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error";
import {
  KNOWN_NOT_SENT,
  knownNotSent,
  outcomeUnknownReason,
} from "../../packages/presentation/wallet-ui/src/sidepanel/shared/submit-outcome";
import { PANEL_ERROR_SOURCES, thrownMessages } from "./internal-error-scan";

const NOT_SENT = /\b(?:not sent|nothing was (?:submitted|signed|sent)|wasn't sent)\b/i;
const MAYBE = /\b(?:may not have gone through|status is unknown|could not be confirmed)\b/i;

describe("known-not-sent refusals", () => {
  // The Send receipt's own "not sent" template is the output, not a refusal.
  const raws = thrownMessages(PANEL_ERROR_SOURCES)
    .map(({ raw }) => raw)
    .filter((raw) => !raw.startsWith("The transaction was not sent."));
  const lowered = new Set(raws.map((raw) => raw.toLowerCase()));

  test("every listed refusal is still minted by the wallet", async () => {
    // The poisoned-recipient refusal is a verifier flag's `message`, which the
    // scan does not read; pinned to its source instead.
    const verifier = (
      await Bun.file("packages/features/transactions/src/routing/verify.ts").text()
    ).toLowerCase();
    const unminted = [...KNOWN_NOT_SENT].filter(
      (raw) => !lowered.has(raw) && !verifier.includes(`"${raw}"`),
    );
    expect(unminted.sort()).toEqual([]);
    expect(KNOWN_NOT_SENT.has(REVIEWED_FEE_REQUIRED.toLowerCase())).toBe(true);
    expect(KNOWN_NOT_SENT.has(INVOKE_NOT_JOURNALED.toLowerCase())).toBe(true);
  });

  test("a message that says nothing was submitted is on the list", () => {
    const missing = raws
      .filter((raw) => NOT_SENT.test(friendlyError(raw).message))
      .filter((raw) => !knownNotSent(new Error(raw)))
      .sort();
    expect(missing).toEqual([]);
  });

  test("no composed outcome-unknown sentence also claims nothing was sent", () => {
    const contradictory = raws
      .filter((raw) => !knownNotSent(new Error(raw)))
      .map((raw) => outcomeUnknownReason(new Error(raw), "The transfer"))
      .filter((sentence) => NOT_SENT.test(sentence))
      .sort();
    expect(contradictory).toEqual([]);
  });

  test("no 'not sent' sentence also says the outcome may be unknown", () => {
    const contradictory = raws
      .filter((raw) => knownNotSent(new Error(raw)))
      .map((raw) => `The transaction was not sent. ${friendlyError(raw).message}`)
      .filter((sentence) => MAYBE.test(sentence))
      .sort();
    expect(contradictory).toEqual([]);
  });

  test("a typed unknown outcome is never known-not-sent", () => {
    expect(knownNotSent(new SubmissionUnknownError("wallet locked", null))).toBe(false);
    expect(knownNotSent(new Error("chain-failed"))).toBe(false);
    expect(knownNotSent(new Error("unexpected-device-error"))).toBe(false);
    expect(knownNotSent("wallet locked")).toBe(false);
  });

  // Audit L2: a private action refused for a balance it read before signing
  // sent nothing, so it must not read as "outcome unknown".
  test("a privacy balance refusal raised before signing is known not sent", () => {
    for (const raw of [
      privacyShortfall("ETH", "private"),
      privacyShortfall("USDC", "public"),
      PRIVACY_PUBLIC_BALANCE_UNCONFIRMED,
    ]) {
      expect(knownNotSent(new Error(raw))).toBe(true);
    }
    // Only the exact refusal shape: a longer sentence is not one.
    expect(knownNotSent(new Error("Not enough signatures yet."))).toBe(false);
    expect(knownNotSent(new Error("Not enough ETH after the transaction was sent"))).toBe(false);
  });
});
