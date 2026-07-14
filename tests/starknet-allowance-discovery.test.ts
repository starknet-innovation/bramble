/**
 * Pure allowance-discovery rules: decoding ERC20 `Approval` events across both
 * key layouts, unlimited-amount detection, uint256 parsing, and merging
 * externally discovered allowances with the locally tracked ones.
 */
import { describe, expect, test } from "bun:test";
import {
  APPROVAL_EVENT_KEY,
  decodeApprovalEvent,
  type ExternalAllowance,
  isAllowanceView,
  isUnlimitedAllowance,
  mergeAllowanceViews,
  parseAllowanceAmount,
} from "../src/starknet/allowance-discovery";
import type { AllowanceRecord } from "../src/storage/allowance-store";

const ACCOUNT = { id: "SN_MAIN:0x1234567890abcdef" };
const OWNER = "0x1234567890abcdef";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = "0x5abcdef";
const OTHER_SPENDER = "0x7feed";
const UNLIMITED = (1n << 128n).toString();

const walletRecord: AllowanceRecord = {
  accountId: ACCOUNT.id,
  amount: "1000",
  id: `${ACCOUNT.id}:0x${BigInt(TOKEN).toString(16)}:${SPENDER}`,
  networkId: "SN_MAIN",
  spender: SPENDER,
  token: `0x${BigInt(TOKEN).toString(16)}`,
};

describe("decodeApprovalEvent", () => {
  test("decodes the Cairo 1 layout with owner and spender as indexed keys", () => {
    expect(
      decodeApprovalEvent({ data: ["0x64", "0x0"], keys: [APPROVAL_EVENT_KEY, OWNER, SPENDER] }),
    ).toEqual({
      owner: `0x${BigInt(OWNER).toString(16)}`,
      spender: `0x${BigInt(SPENDER).toString(16)}`,
    });
  });

  test("decodes the legacy layout with owner and spender in the data payload", () => {
    expect(
      decodeApprovalEvent({ data: [OWNER, SPENDER, "0x64", "0x0"], keys: [APPROVAL_EVENT_KEY] }),
    ).toEqual({
      owner: `0x${BigInt(OWNER).toString(16)}`,
      spender: `0x${BigInt(SPENDER).toString(16)}`,
    });
  });

  test("rejects an event whose first key is not the Approval selector", () => {
    expect(
      decodeApprovalEvent({ data: ["0x64", "0x0"], keys: ["0x1", OWNER, SPENDER] }),
    ).toBeNull();
  });

  test("rejects a zero owner or spender", () => {
    expect(
      decodeApprovalEvent({ data: ["0x64", "0x0"], keys: [APPROVAL_EVENT_KEY, "0x0", SPENDER] }),
    ).toBeNull();
    expect(
      decodeApprovalEvent({ data: [OWNER, "0x0", "0x64"], keys: [APPROVAL_EVENT_KEY] }),
    ).toBeNull();
  });
});

describe("isUnlimitedAllowance", () => {
  test("treats a value at or above the 2^128 threshold as unlimited", () => {
    expect(isUnlimitedAllowance(UNLIMITED)).toBe(true);
    expect(isUnlimitedAllowance("340282366920938463463374607431768211456")).toBe(true);
  });

  test("treats a bounded or malformed amount as not unlimited", () => {
    expect(isUnlimitedAllowance("1000")).toBe(false);
    expect(isUnlimitedAllowance("not-a-number")).toBe(false);
  });
});

describe("parseAllowanceAmount", () => {
  test("combines the uint256 low and high words into a decimal string", () => {
    expect(parseAllowanceAmount(["0x64", "0x0"])).toBe("100");
    expect(parseAllowanceAmount(["0x0", "0x1"])).toBe(UNLIMITED);
  });

  test("returns null for a malformed response", () => {
    expect(parseAllowanceAmount(["0x64"])).toBeNull();
    expect(parseAllowanceAmount(["nope", "0x0"])).toBeNull();
  });
});

describe("mergeAllowanceViews", () => {
  test("labels tracked entries as wallet-sourced and passes an empty external list through", () => {
    expect(mergeAllowanceViews([walletRecord], [], ACCOUNT, "SN_MAIN")).toEqual([
      { ...walletRecord, source: "wallet" },
    ]);
  });

  test("appends externally discovered allowances labelled as external", () => {
    const external: readonly ExternalAllowance[] = [
      { amount: UNLIMITED, spender: OTHER_SPENDER, token: TOKEN },
    ];
    const merged = mergeAllowanceViews([walletRecord], external, ACCOUNT, "SN_MAIN");
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({
      amount: UNLIMITED,
      source: "external",
      spender: `0x${BigInt(OTHER_SPENDER).toString(16)}`,
    });
    expect(merged.every(isAllowanceView)).toBe(true);
  });

  test("drops an external allowance that duplicates a tracked (token, spender)", () => {
    const external: readonly ExternalAllowance[] = [
      { amount: "999", spender: SPENDER, token: TOKEN },
    ];
    const merged = mergeAllowanceViews([walletRecord], external, ACCOUNT, "SN_MAIN");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("wallet");
  });

  test("omits zero-amount and malformed external allowances", () => {
    const external: readonly ExternalAllowance[] = [
      { amount: "0", spender: OTHER_SPENDER, token: TOKEN },
      { amount: "5", spender: "0xnot-a-felt", token: TOKEN },
    ];
    expect(mergeAllowanceViews([], external, ACCOUNT, "SN_MAIN")).toEqual([]);
  });
});
