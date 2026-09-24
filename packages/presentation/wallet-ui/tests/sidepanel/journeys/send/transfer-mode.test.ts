/**
 * The name a composed send goes by, derived from its buckets and recipient.
 *
 * Only the two bucket-crossing self-transfers earn a name of their own; every
 * other configuration is a send, so the mode can never claim a shield the route
 * is not going to perform.
 */
import { describe, expect, test } from "bun:test";
import { account, secondAccount } from "@bramble/testkit/sidepanel";
import {
  transferModeCopy,
  transferModeFor,
  transferStageTitle,
  transferSuccessSummary,
} from "../../../../src/sidepanel/journeys/send/transfer-mode";

const self = account.address;

describe("transferModeFor", () => {
  test("names the two self-transfers that cross buckets", () => {
    expect(
      transferModeFor({ destination: "private", recipient: self, source: "public" }, self),
    ).toBe("shield");
    expect(
      transferModeFor({ destination: "public", recipient: self, source: "private" }, self),
    ).toBe("unshield");
  });

  test("recognises the sender under any felt spelling", () => {
    // Addresses arrive canonical from the form but padded from an intent; the
    // shared felt comparison, not string equality, decides "yourself".
    const padded = `0x0${self.slice(2)}`;
    expect(
      transferModeFor({ destination: "private", recipient: padded, source: "public" }, self),
    ).toBe("shield");
  });

  test("everything else is a send", () => {
    const other = secondAccount.address;
    // A private deposit into someone else's channel is a send, not a shield.
    expect(
      transferModeFor({ destination: "private", recipient: other, source: "public" }, self),
    ).toBe("send");
    // Same bucket on both ends moves nothing between balances.
    expect(
      transferModeFor({ destination: "public", recipient: self, source: "public" }, self),
    ).toBe("send");
    expect(
      transferModeFor({ destination: "private", recipient: self, source: "private" }, self),
    ).toBe("send");
    // No recipient yet, or no active account to compare against.
    expect(transferModeFor({ destination: "private", recipient: "", source: "public" }, self)).toBe(
      "send",
    );
    expect(transferModeFor({ destination: "private", recipient: self, source: "public" }, "")).toBe(
      "send",
    );
  });
});

describe("mode copy", () => {
  test("titles every checkpoint in the mode's own words", () => {
    expect(transferStageTitle("recipient")).toBe("Send to");
    expect(transferStageTitle("details", "shield")).toBe("Shield");
    expect(transferStageTitle("reviewing", "unshield")).toBe("Unshield");
    expect(transferStageTitle("review", "shield")).toBe("Review shield");
    expect(transferStageTitle("authorizing", "unshield")).toBe("Authorize unshield");
    expect(transferStageTitle("broadcasting", "shield")).toBe("Shielding");
    expect(transferStageTitle("failed", "shield")).toBe("Shield failed");
    // Chain-side checkpoints are the same for every mode.
    expect(transferStageTitle("confirming", "shield")).toBe("Confirming");
    expect(transferStageTitle("submitted", "unshield")).toBe("Confirmed");
  });

  test("keeps the plain send's wording unchanged", () => {
    expect(transferStageTitle("details")).toBe("Send");
    expect(transferStageTitle("review")).toBe("Review send");
    expect(transferModeCopy("send").confirmLabel).toBe("Confirm and send");
    expect(transferModeCopy("send").successTitle).toBe("Send complete");
  });

  test("names the wait behind Review in the mode's own words", () => {
    // The busy button and the working screen both read from this, so a shield
    // being proved is never labelled as a send being estimated.
    expect(transferModeCopy("send").preparing).toBe("Preparing send");
    expect(transferModeCopy("shield").preparing).toBe("Preparing shield");
    expect(transferModeCopy("unshield").preparing).toBe("Preparing unshield");
  });

  test("receipts name the bucket the value landed in", () => {
    expect(transferSuccessSummary("shield", "1", "ETH", "Account 1")).toBe(
      "1 ETH shielded into your private balance",
    );
    expect(transferSuccessSummary("unshield", "2", "STRK", "Account 1")).toBe(
      "2 STRK unshielded into your public balance",
    );
    expect(transferSuccessSummary("send", "3", "ETH", "Alice")).toBe("3 ETH sent to Alice");
  });
});
