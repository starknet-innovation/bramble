/**
 * Classifying why activation cannot proceed into the next thing to do.
 *
 * The messages are the privileged runtime's own; the classifier reads them by
 * prefix so a trailing detail does not defeat the match, and treats anything it
 * does not recognise as a service condition worth retrying — never as nothing.
 */
import { describe, expect, test } from "bun:test";
import { privacyBlockerFor } from "../../../../src/sidepanel/journeys/privacy/privacy-model";

describe("privacyBlockerFor", () => {
  test("maps each runtime prerequisite onto its screen", () => {
    expect(privacyBlockerFor("Not enough STRK for the pool fee").kind).toBe("fund");
    expect(privacyBlockerFor("Not enough STRK for the amount and pool fee").kind).toBe("fund");
    expect(
      privacyBlockerFor("Deploy this account before using public privacy transactions").kind,
    ).toBe("deploy");
    expect(privacyBlockerFor("Private balances are not configured for this network").kind).toBe(
      "network",
    );
    expect(privacyBlockerFor("Private balances are not available for Ledger accounts").kind).toBe(
      "ledger",
    );
    expect(privacyBlockerFor("A registration is already on its way for this account").kind).toBe(
      "pending",
    );
  });

  test("keeps the reported message alongside the classification", () => {
    expect(privacyBlockerFor("Not enough STRK for the pool fee")).toEqual({
      kind: "fund",
      message: "Not enough STRK for the pool fee",
    });
  });

  test("treats anything unrecognised as a retryable service condition", () => {
    expect(privacyBlockerFor("prover offline").kind).toBe("service");
    expect(privacyBlockerFor("").kind).toBe("service");
    // A shortfall of another token is a send-time refusal, not a funding step.
    expect(privacyBlockerFor("Not enough ETH").kind).toBe("service");
  });
});
