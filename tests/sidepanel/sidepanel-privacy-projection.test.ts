/**
 * Shield/unshield projection: the destination shows what actually arrives, the
 * fee sentence names who pays, and Max reserves a same-asset pool fee so a
 * composed amount can never be unaffordable.
 */
import { describe, expect, test } from "bun:test";
import { maxPrivacyMove, projectPrivacyMove } from "../../src/sidepanel/privacy-projection";

// 4 STRK, the mainnet pool's action fee.
const POOL_FEE = "0x3782dace9d900000";
const STRK_CONTEXT = {
  decimals: 18,
  feeInSameToken: true,
  poolFeeFri: POOL_FEE,
  symbol: "STRK",
};

describe("privacy move projection", () => {
  test("shielding receives the full amount and names the extra pool fee", () => {
    const projection = projectPrivacyMove({
      ...STRK_CONTEXT,
      amount: "10",
      sourceBalanceRaw: "100000000000000000000",
      unshielding: false,
    });

    expect(projection.received).toBe("10");
    expect(projection.feeNote).toBe(
      "4 STRK get deducted from your public balance to cover pool fees",
    );
    // A fee the user simply pays is information, not an alarm.
    expect(projection.feeTone).toBe("info");
  });

  test("shielding warns when the balance cannot cover amount plus fee", () => {
    const projection = projectPrivacyMove({
      ...STRK_CONTEXT,
      // 10 STRK balance, shielding all of it leaves nothing for the 4 STRK fee.
      amount: "10",
      sourceBalanceRaw: "10000000000000000000",
      unshielding: false,
    });

    expect(projection.feeNote).toContain("Not enough to cover the 4 STRK pool fee");
    // Only a blocker earns the warning treatment.
    expect(projection.feeTone).toBe("warning");
  });

  test("a non-STRK asset shields without touching its own amount", () => {
    const projection = projectPrivacyMove({
      amount: "1.25",
      decimals: 18,
      feeInSameToken: false,
      poolFeeFri: POOL_FEE,
      sourceBalanceRaw: "1250000000000000000",
      symbol: "ETH",
      unshielding: false,
    });

    expect(projection.received).toBe("1.25");
    expect(projection.feeNote).toBe(
      "4 STRK get deducted from your public balance to cover pool fees",
    );
    // A fee the user simply pays is information, not an alarm.
    expect(projection.feeTone).toBe("info");
  });

  test("unshielding defers the relay fee to the review", () => {
    const projection = projectPrivacyMove({
      ...STRK_CONTEXT,
      amount: "2",
      sourceBalanceRaw: "5000000000000000000",
      unshielding: true,
    });

    expect(projection.received).toBe("2");
    expect(projection.feeNote).toContain("quoted on the next screen");
  });

  test("an empty or malformed amount projects zero without a fee note", () => {
    for (const amount of ["", "   ", "abc", "-1"]) {
      const projection = projectPrivacyMove({
        ...STRK_CONTEXT,
        amount,
        sourceBalanceRaw: "5000000000000000000",
        unshielding: false,
      });
      expect(projection.received).toBe("0");
      expect(projection.feeNote).toBe("");
    }
  });

  test("Max reserves the pool fee only when it is charged in the same asset", () => {
    // 10 STRK public: Max leaves the 4 STRK fee payable.
    expect(
      maxPrivacyMove({
        decimals: 18,
        feeInSameToken: true,
        poolFeeFri: POOL_FEE,
        sourceBalanceRaw: "10000000000000000000",
        unshielding: false,
      }),
    ).toBe("6");
    // A different asset pays the fee in STRK, so its own Max is the full balance.
    expect(
      maxPrivacyMove({
        decimals: 18,
        feeInSameToken: false,
        poolFeeFri: POOL_FEE,
        sourceBalanceRaw: "1250000000000000000",
        unshielding: false,
      }),
    ).toBe("1.25");
    // Unshielding pays the relay from shielded balance, quoted later.
    expect(
      maxPrivacyMove({
        decimals: 18,
        feeInSameToken: true,
        poolFeeFri: POOL_FEE,
        sourceBalanceRaw: "5000000000000000000",
        unshielding: true,
      }),
    ).toBe("5");
  });

  test("a balance below the fee maxes at zero instead of going negative", () => {
    expect(
      maxPrivacyMove({
        decimals: 18,
        feeInSameToken: true,
        poolFeeFri: POOL_FEE,
        sourceBalanceRaw: "1000000000000000000",
        unshielding: false,
      }),
    ).toBe("0");
  });
});
