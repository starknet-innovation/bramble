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
} from "@mc-wallet/transactions/allowance-discovery";
import type { AllowanceRecord } from "@mc-wallet/transactions/allowance-store";

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

const merge = (
  inWallet: readonly AllowanceRecord[],
  external: readonly ExternalAllowance[],
  multisig: readonly AllowanceRecord[] = [],
) => mergeAllowanceViews({ account: ACCOUNT, external, inWallet, multisig, networkId: "SN_MAIN" });

describe("mergeAllowanceViews", () => {
  test("labels tracked entries as wallet-sourced and passes an empty external list through", () => {
    expect(merge([walletRecord], [])).toEqual([{ ...walletRecord, source: "wallet" }]);
  });

  test("appends externally discovered allowances labelled as external", () => {
    const external: readonly ExternalAllowance[] = [
      { amount: UNLIMITED, spender: OTHER_SPENDER, token: TOKEN },
    ];
    const merged = merge([walletRecord], external);
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
    const merged = merge([walletRecord], external);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("wallet");
  });

  // MCW-V09-108: the tracked amount is a LOWER bound — it cannot see an
  // approval granted outside this wallet that a later `increase_allowance`
  // added to. Reporting the tracked amount over a larger on-chain reading
  // understated a standing allowance the manager used to report correctly, and
  // dropped the side panel's "Unlimited" badge with it.
  test("keeps the larger on-chain amount for a tracked (token, spender)", () => {
    const merged = merge([walletRecord], [{ amount: UNLIMITED, spender: SPENDER, token: TOKEN }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ amount: UNLIMITED, source: "wallet" });
    expect(isUnlimitedAllowance(merged[0]?.amount ?? "")).toBe(true);
    expect(merged.every(isAllowanceView)).toBe(true);
  });

  // The other direction is a claim a hostile or lagging node must not be able
  // to make: an approval this wallet just broadcast is not yet mined, and a
  // node that answers "0" (or with an unreadable amount) must not be able to
  // shrink a tracked grant out of the manager.
  test("never lets a smaller or malformed on-chain amount shrink a tracked grant", () => {
    for (const amount of ["0", "1", "not-a-number", ""]) {
      const merged = merge([walletRecord], [{ amount, spender: SPENDER, token: TOKEN }]);
      expect(merged).toHaveLength(1);
      expect(merged[0]?.amount).toBe(walletRecord.amount);
    }
  });

  test("labels a multisig-owned record as such and never merges it with another owner's reading", () => {
    const multisigRecord: AllowanceRecord = {
      ...walletRecord,
      accountId: "SN_MAIN:0xabc",
      id: `SN_MAIN:0xabc:${walletRecord.token}:${SPENDER}`,
    };
    const merged = merge(
      [],
      [{ amount: UNLIMITED, spender: SPENDER, token: TOKEN }],
      [multisigRecord],
    );
    expect(merged[0]).toMatchObject({ amount: "1000", source: "multisig" });
    // The scan reads the ACTIVE account's address, so its answer is a fact
    // about that account — the multisig's own entry keeps its tracked amount
    // and the reading is still listed under the account it belongs to.
    expect(merged[1]).toMatchObject({ amount: UNLIMITED, source: "external" });
    expect(merged.every(isAllowanceView)).toBe(true);
  });

  // MCW-V09-108(c): the manager marks a row whose contract it cannot call a
  // token. That marking is what withholds the amount claim and the revoke
  // control, so it has to survive the message boundary the panel parses
  // responses through — and only in its one legal spelling.
  test("carries the unconfirmed-token marking across the message boundary", () => {
    expect(isAllowanceView({ ...walletRecord, source: "wallet", unconfirmedToken: true })).toBe(
      true,
    );
    for (const unconfirmedToken of [false, "true", 1, null]) {
      expect(isAllowanceView({ ...walletRecord, source: "wallet", unconfirmedToken })).toBe(false);
    }
  });

  test("omits zero-amount and malformed external allowances", () => {
    const external: readonly ExternalAllowance[] = [
      { amount: "0", spender: OTHER_SPENDER, token: TOKEN },
      { amount: "5", spender: "0xnot-a-felt", token: TOKEN },
    ];
    expect(merge([], external)).toEqual([]);
  });
});
