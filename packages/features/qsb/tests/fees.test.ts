/**
 * The deposit's size and fee follow qsb-app's formula (the worked example: one
 * input, change and a 9,923-byte script make 10,044 vB, 20,088 sats at
 * 2 sat/vB), change appears only above the dust limit, MARA's floor is the
 * higher of its two rates rounded up, and coins are chosen largest first,
 * ties by txid then output, one to eight of them.
 */
import { describe, expect, test } from "bun:test";
import { selectQsbCoins } from "@bramble/qsb/coins";
import {
  qsbCeilMilliSatPerVb,
  qsbDepositFee,
  qsbDepositVsize,
  qsbFeeAt,
  qsbFormatFeeRate,
  qsbMinerFloorMsat,
  qsbWithdrawalFeeSat,
} from "@bramble/qsb/fees";

const SCRIPT_BYTES = 9_923;

describe("deposit size and fee", () => {
  test("matches the spec's worked example", () => {
    expect(qsbDepositVsize(1, SCRIPT_BYTES, true)).toBe(10_044);
    expect(qsbFeeAt(10_044, 2_000n)).toBe(20_088n);
  });

  test("counts inputs, varints and change", () => {
    expect(qsbDepositVsize(1, SCRIPT_BYTES, false)).toBe(10_044 - 31);
    expect(qsbDepositVsize(2, SCRIPT_BYTES, true) - qsbDepositVsize(1, SCRIPT_BYTES, true)).toBe(
      68,
    );
    // A script under 253 bytes takes a one-byte length.
    expect(qsbDepositVsize(1, 252, true) - qsbDepositVsize(1, 253, true)).toBe(-3);
  });

  test("rounds a fractional fee up", () => {
    expect(qsbFeeAt(3, 1_001n)).toBe(4n);
  });

  test("returns change only at or above the dust limit", () => {
    const fee = 20_088n;
    const exact = qsbDepositFee({
      amountSat: 100_000n,
      inputValues: [100_000n + fee + 294n],
      rateMsat: 2_000n,
      scriptBytes: SCRIPT_BYTES,
    });
    expect(exact).toEqual({ changeSat: 294n, feeSat: fee, vsize: 10_044 });
    const dust = qsbDepositFee({
      amountSat: 100_000n,
      inputValues: [100_000n + fee + 293n],
      rateMsat: 2_000n,
      scriptBytes: SCRIPT_BYTES,
    });
    expect(dust).toEqual({ changeSat: 0n, feeSat: fee + 293n, vsize: 10_013 });
  });

  test("refuses funds that cannot pay the no-change fee", () => {
    const noChangeFee = qsbFeeAt(10_013, 2_000n);
    const input = { amountSat: 100_000n, rateMsat: 2_000n, scriptBytes: SCRIPT_BYTES };
    expect(qsbDepositFee({ ...input, inputValues: [100_000n + noChangeFee] })?.changeSat).toBe(0n);
    expect(qsbDepositFee({ ...input, inputValues: [100_000n + noChangeFee - 1n] })).toBeNull();
    expect(qsbDepositFee({ ...input, inputValues: [] })).toBeNull();
    expect(qsbDepositFee({ ...input, amountSat: 0n, inputValues: [1_000_000n] })).toBeNull();
  });
});

describe("MARA's floor", () => {
  test("is the higher of the submit and market rates, rounded up to a millisat", () => {
    expect(qsbMinerFloorMsat({ marketRate: 1, submitFeeRate: 2 })).toBe(2_000n);
    expect(qsbMinerFloorMsat({ marketRate: 4.03, submitFeeRate: 2 })).toBe(4_030n);
    expect(qsbMinerFloorMsat({ marketRate: 2.0001, submitFeeRate: 1 })).toBe(2_001n);
    expect(qsbCeilMilliSatPerVb(4.03)).toBe(4_030n);
  });

  test.each([
    [0, 0],
    [Number.NaN, 2],
    [1_000.001, 1],
    [Number.POSITIVE_INFINITY, 1],
  ])("fails closed for market %p and submit %p", (marketRate, submitFeeRate) => {
    expect(qsbMinerFloorMsat({ marketRate, submitFeeRate })).toBeNull();
  });

  test("formats a rate as parseFeeRate reads it back", () => {
    expect(qsbFormatFeeRate(2_000n)).toBe("2");
    expect(qsbFormatFeeRate(2_250n)).toBe("2.25");
    expect(qsbFormatFeeRate(1_001n)).toBe("1.001");
  });

  test("estimates the withdrawal over the largest scriptSig and a 34-byte output", () => {
    // 4 + 1 + 41 + 32 + 4 + 3 + 1,185 + 4 + (1 + 8 + 1 + 34) + 4 = 1,322 base bytes, 111 witness.
    expect(qsbWithdrawalFeeSat(1_000n)).toBe(BigInt(Math.ceil((1_322 * 4 + 111) / 4)));
  });
});

describe("coin selection", () => {
  const coin = (valueSat: number, txid: string, vout = 0) => ({
    txid: txid.repeat(64).slice(0, 64),
    valueSat,
    vout,
  });

  test("takes the largest coin that covers amount and fee", () => {
    const selection = selectQsbCoins({
      amountSat: 50_000,
      coins: [coin(10_000, "a"), coin(200_000, "b"), coin(90_000, "c")],
      rateMsat: 2_000n,
      scriptBytes: SCRIPT_BYTES,
    });
    expect(selection?.coins.map((c) => c.valueSat)).toEqual([200_000]);
    expect(selection?.feeSat).toBe(20_088n);
    expect(selection?.changeSat).toBe(200_000n - 50_000n - 20_088n);
  });

  test("adds coins in order until the fee their count implies is covered", () => {
    const selection = selectQsbCoins({
      amountSat: 60_000,
      coins: [coin(40_000, "a"), coin(40_000, "b"), coin(30_000, "c")],
      rateMsat: 2_000n,
      scriptBytes: SCRIPT_BYTES,
    });
    expect(selection?.coins.map((c) => c.txid[0])).toEqual(["a", "b", "c"]);
  });

  test("breaks value ties by txid, then output index", () => {
    const selection = selectQsbCoins({
      amountSat: 10_000,
      coins: [coin(100_000, "b", 0), coin(100_000, "a", 3), coin(100_000, "a", 1)],
      rateMsat: 2_000n,
      scriptBytes: SCRIPT_BYTES,
    });
    expect(selection?.coins).toEqual([coin(100_000, "a", 1)]);
  });

  test("spends at most eight coins", () => {
    // Twelve coins would cover it; the first eight cannot.
    const coins = Array.from({ length: 12 }, (_, index) => coin(5_000, index.toString(16)));
    expect(
      selectQsbCoins({ amountSat: 30_000, coins, rateMsat: 2_000n, scriptBytes: SCRIPT_BYTES }),
    ).toBeNull();
    expect(
      selectQsbCoins({ amountSat: 1, coins, rateMsat: 1_000n, scriptBytes: 100 })?.coins,
    ).toHaveLength(1);
  });

  test("answers null when no funds exist", () => {
    expect(
      selectQsbCoins({ amountSat: 1, coins: [], rateMsat: 2_000n, scriptBytes: SCRIPT_BYTES }),
    ).toBeNull();
  });
});
