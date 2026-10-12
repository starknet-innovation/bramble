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

describe("summarizeStrk20Action amounts (Sherlock 154)", () => {
  const STRK = { decimals: 18, symbol: "STRK" };
  const trusted = (token: string) => (token === TOKEN ? STRK : undefined);
  const hundred = `0x${(100n * 10n ** 18n).toString(16)}`;

  test("states a trusted token's amount in its own units and symbol", () => {
    expect(
      summarizeStrk20Action(
        { amount: hundred, recipient: PAYEE, token: TOKEN, type: "withdraw" },
        ACCOUNT,
        trusted,
      ),
    ).toBe(
      `Withdraw 100 STRK to ${PAYEE.slice(0, 8)}…${PAYEE.slice(-4)} (${TOKEN.slice(0, 8)}…${TOKEN.slice(-4)})`,
    );
    expect(
      summarizeStrk20Action(
        { amount: "0xde0b6b3a7640000", recipient: PAYEE, token: TOKEN, type: "transfer" },
        ACCOUNT,
        trusted,
      ),
    ).toContain("Transfer 1 STRK privately");
    expect(
      summarizeStrk20Action({ amount: hundred, token: TOKEN, type: "deposit" }, ACCOUNT, trusted),
    ).toContain("Deposit 100 STRK to private balance");
  });

  test("keeps the exact felt for a token the wallet does not trust", () => {
    expect(
      summarizeStrk20Action(
        { amount: hundred, recipient: PAYEE, token: TOKEN, type: "withdraw" },
        ACCOUNT,
        () => undefined,
      ),
    ).toContain(`Withdraw ${hundred} to`);
    expect(
      summarizeStrk20Action(
        { amount: hundred, recipient: PAYEE, token: TOKEN, type: "withdraw" },
        ACCOUNT,
      ),
    ).toContain(`Withdraw ${hundred} to`);
  });

  test("never guesses a decimal point from unusable metadata", () => {
    const broken = () => ({ decimals: -1, symbol: "STRK" });
    expect(
      summarizeStrk20Action({ amount: hundred, token: TOKEN, type: "deposit" }, ACCOUNT, broken),
    ).toContain(`Deposit ${hundred} to`);
  });

  test("leaves an open note as an open note", () => {
    expect(
      summarizeStrk20Action(
        { amount: "OPEN", recipient: PAYEE, token: TOKEN, type: "transfer" },
        ACCOUNT,
        trusted,
      ),
    ).toContain("Transfer an open note privately");
  });
});
