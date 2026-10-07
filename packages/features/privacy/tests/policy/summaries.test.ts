/**
 * Audit finding 139: a STRK20 `deposit` carrying a `recipient` credits that
 * account's private balance, not the depositor's. Its review summary must name
 * the payee, or a site can present a payment as a self-shield.
 */
import { describe, expect, test } from "bun:test";
import { summarizeStrk20Action } from "../../src/policy/summaries";

const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const ACCOUNT = "0x01234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
const PAYEE = "0xa77ac4e2a77ac4e2a77ac4e2a77ac4e2a77ac4e2a77ac4e2a77ac4e2a77ac4";

describe("summarizeStrk20Action deposit recipient", () => {
  test("a deposit without a recipient reads as a shield into the private balance", () => {
    expect(summarizeStrk20Action({ amount: "0x5", token: TOKEN, type: "deposit" }, ACCOUNT)).toBe(
      "Deposit 0x5 to private balance (0x049d36…4dc7)",
    );
  });

  test("a deposit to the depositor's own address reads as a shield, felt-equal or not", () => {
    const unpadded = `0x${ACCOUNT.slice(3)}`;
    expect(
      summarizeStrk20Action(
        { amount: "0x5", recipient: unpadded, token: TOKEN, type: "deposit" },
        ACCOUNT,
      ),
    ).toBe("Deposit 0x5 to private balance (0x049d36…4dc7)");
  });

  test("a deposit paying another account names that account as the payee", () => {
    expect(
      summarizeStrk20Action(
        { amount: "0x5", recipient: PAYEE, token: TOKEN, type: "deposit" },
        ACCOUNT,
      ),
    ).toBe("Pay 0x5 privately to 0xa77ac4…7ac4 (0x049d36…4dc7)");
  });

  test("a recipient-bearing deposit with no known depositor still names the payee", () => {
    expect(
      summarizeStrk20Action({ amount: "0x5", recipient: PAYEE, token: TOKEN, type: "deposit" }),
    ).toContain("privately to 0xa77ac4");
  });
});
