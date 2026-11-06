/**
 * The "Your stakes" reader: Starkscan's positions for one address are
 * untrusted, so every field the wallet reads is checked, a malformed answer is
 * refused whole, it must answer for this chain and this address, and anything
 * short of prepared, untruncated coverage is incomplete, never "no stakes".
 * Fixtures are schema-derived, not live (see ../support/staking-positions-fixture).
 */
import { describe, expect, test } from "bun:test";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { MAX_STAKING_POSITIONS, parseStakingPositions } from "../../src/staking/staking-positions";
import { position, positionsView } from "../support/staking-positions-fixture";

const ACCOUNT = `0x0${"1".repeat(63)}`;
const A = "0x0a1";
const B = "0xb2";
const parse = (value: unknown) => parseStakingPositions(value, "SN_MAIN", ACCOUNT);
const one = (overrides: Readonly<Record<string, unknown>>) =>
  positionsView(ACCOUNT, [position(ACCOUNT, A, overrides)]);

describe("parseStakingPositions", () => {
  test("reads a schema-shaped answer as canonical candidates, in order", () => {
    expect(
      parse(
        positionsView(ACCOUNT, [
          position(ACCOUNT, A),
          position(ACCOUNT, B, { pendingExitRaw: "1", status: "exiting" }),
        ]),
      ),
    ).toEqual({
      complete: true,
      positions: [
        { staker: "0xa1", token: STRK_TOKEN_ADDRESS },
        { staker: "0xb2", token: STRK_TOKEN_ADDRESS },
      ],
    });
  });

  test("accepts the account in any felt spelling, and ignores unread fields", () => {
    const short = `0x${"1".repeat(63)}`;
    expect(
      parse(
        positionsView(short.toUpperCase().replace("0X", "0x"), [position(short, A)], { extra: 1 }),
      ),
    ).toMatchObject({ complete: true });
  });

  test("an empty list is complete only with prepared, untruncated coverage", () => {
    expect(parse(positionsView(ACCOUNT, []))).toEqual({ complete: true, positions: [] });
    const coverage = (status: string) => ({
      ...(positionsView(ACCOUNT, [])["coverage"] as object),
      status,
    });
    for (const status of ["catching_up", "unavailable"]) {
      expect(parse(positionsView(ACCOUNT, [], { coverage: coverage(status) }))).toEqual({
        complete: false,
        positions: [],
      });
    }
    expect(
      parse(positionsView(ACCOUNT, [position(ACCOUNT, A)], { positionsTruncated: true })),
    ).toMatchObject({ complete: false, positions: [{ staker: "0xa1" }] });
  });

  test("refuses the whole answer for anything malformed or out of bounds", () => {
    const base = positionsView(ACCOUNT, [position(ACCOUNT, A)]);
    const malformed: unknown[] = [
      null,
      [],
      { ...base, chainId: "SN_SEPOLIA" },
      { ...base, source: "live" },
      { ...base, address: `0x${"2".repeat(63)}` },
      { ...base, address: "not-a-felt" },
      { ...base, coverage: { status: "done" } },
      { ...base, coverage: null },
      { ...base, positionsTruncated: "false" },
      { ...base, positionsTruncated: undefined },
      { ...base, positions: {} },
      positionsView(
        ACCOUNT,
        Array.from({ length: MAX_STAKING_POSITIONS + 1 }, (_, index) =>
          position(ACCOUNT, `0x${(index + 1).toString(16)}`),
        ),
      ),
      positionsView(ACCOUNT, [position(ACCOUNT, A), position(ACCOUNT, "0xA1")]),
      positionsView(ACCOUNT, ["0xa1"]),
      one({ address: `0x${"2".repeat(63)}` }),
      one({ validatorAddress: "0x0" }),
      one({ validatorAddress: `0x${"f".repeat(64)}` }),
      one({ validatorAddress: "validator" }),
      one({ tokenAddress: null }),
      one({ poolAddress: "pool" }),
      one({ delegatedRaw: null }),
      one({ delegatedRaw: "-1" }),
      one({ delegatedRaw: "1".repeat(79) }),
      one({ pendingExitRaw: "0x1" }),
      one({ status: "withdrawn" }),
      one({ status: null }),
    ];
    for (const value of malformed) expect(parse(value)).toBeNull();
  });

  test("the same validator with another token is a separate position", () => {
    expect(
      parse(
        positionsView(ACCOUNT, [
          position(ACCOUNT, A),
          position(ACCOUNT, A, { tokenAddress: "0xb7c" }),
        ]),
      )?.positions,
    ).toHaveLength(2);
  });

  test("accepts exactly the schema's bound", () => {
    const many = Array.from({ length: MAX_STAKING_POSITIONS }, (_, index) =>
      position(ACCOUNT, `0x${(index + 1).toString(16)}`),
    );
    expect(parse(positionsView(ACCOUNT, many))?.positions).toHaveLength(MAX_STAKING_POSITIONS);
  });
});
