/**
 * Activity rows show amounts to at most four decimal places, trimming longer
 * figures and leaving shorter ones untouched; identifiers are never altered.
 * The row model derives the verb, glyph, detail line, and figures from the
 * record, and prices a row only when the token and price are both certain.
 */
import { describe, expect, test } from "bun:test";
import type { TokenConfig } from "@bramble/settings/preferences";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import {
  activityAppearance,
  activityRowModel,
  compactActivityAmount,
  compactSummary,
} from "../../../../src/sidepanel/journeys/portfolio/activity-format";

describe("compactSummary", () => {
  test("trims figures longer than four decimals and keeps shorter ones as written", () => {
    expect(compactSummary("Sent 1.234567890123456789 ETH to 0x1234…abcd")).toBe(
      "Sent 1.2345 ETH to 0x1234…abcd",
    );
    expect(compactSummary("Received 0.5 STRK from 0x9f…12")).toBe("Received 0.5 STRK from 0x9f…12");
    expect(compactSummary("Swapped 1,234.56789 USDC for STRK")).toBe(
      "Swapped 1,234.5678 USDC for STRK",
    );
    expect(compactSummary("Sent 2.5000 ETH")).toBe("Sent 2.5000 ETH");
  });

  test("keeps tiny sub-unit amounts legible instead of rounding them to zero", () => {
    expect(compactSummary("Received 0.00001234 ETH")).toBe("Received 0.00001234 ETH");
  });

  test("never touches hex identifiers or integers", () => {
    const summary =
      "Approve 0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7 for 100 STRK";
    expect(compactSummary(summary)).toBe(summary);
    expect(compactSummary("Claimed staking rewards")).toBe("Claimed staking rewards");
  });
});

describe("compactActivityAmount", () => {
  test("applies the four-place ceiling and groups thousands", () => {
    expect(compactActivityAmount("12.345678")).toBe("12.3456");
    expect(compactActivityAmount("1234.5")).toBe("1,234.5");
    expect(compactActivityAmount("1.50")).toBe("1.5");
    expect(compactActivityAmount("3")).toBe("3");
    expect(compactActivityAmount("0.00001234")).toBe("0.00001234");
  });
});

const entry: ActivityEntry = {
  accountId: "SN_MAIN:0x1",
  hash: "0x1",
  kind: "invoke",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt: 1,
  summary: "Call transfer on 0x1234…abcd",
};

describe("activityAppearance", () => {
  test("maps every kind to its verb, glyph, and value direction", () => {
    const rows: ReadonlyArray<readonly [Partial<ActivityEntry>, string, string, string | null]> = [
      [{ kind: "transfer", summary: "Send 1 STRK" }, "Sent", "arrowDownRight", "out"],
      [
        { kind: "transfer", summary: "Received 1 STRK from 0x…" },
        "Received",
        "arrowDownLeft",
        "in",
      ],
      [{ summary: "Swap 1 STRK for USDC" }, "Swapped", "arrowLeftRight", "out"],
      [{ summary: "Stake 10 STRK" }, "Staked", "lockKeyhole", "out"],
      [{ summary: "Unstake 10 STRK" }, "Unstaked", "lockKeyholeOpen", "in"],
      [{ summary: "Claimed staking rewards" }, "Claimed rewards", "creditCard", "in"],
      [{ summary: "Send 5 USDC privately" }, "Private transfer", "shield", "out"],
      [{ summary: "Shield 5 USDC" }, "Shielded", "shield", null],
      [{ summary: "Unshield 5 USDC" }, "Unshielded", "shield", null],
      [{ summary: "Activate private balances" }, "Private transaction", "shield", null],
      [{ summary: "Allow 0x… to spend 5 STRK" }, "Approved", "keyRound", null],
      [{ summary: "Revoke approval" }, "Revoked", "keyRound", null],
      [{ kind: "deploy", summary: "Deploy account contract" }, "Deployed", "rocket", null],
      [{ kind: "declare", summary: "Declare class 0x…" }, "Declared", "terminal", null],
      [{}, "Interacted", "layoutGrid", null],
    ];
    for (const [patch, title, icon, direction] of rows) {
      const appearance = activityAppearance({ ...entry, ...patch });
      expect([appearance.title, appearance.icon, appearance.direction]).toEqual([
        title,
        icon,
        direction,
      ]);
    }
  });
});

describe("activityRowModel", () => {
  const strk: TokenConfig = {
    address: STRK_TOKEN_ADDRESS,
    decimals: 18,
    id: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
    name: "Starknet Token",
    networkId: "SN_MAIN",
    symbol: "STRK",
  };
  const pricing = { currency: "usd" as const, prices: { [STRK_TOKEN_ADDRESS]: 2 }, tokens: [strk] };

  test("prices only a directional amount whose symbol maps to exactly one tracked, priced token", () => {
    const sent = {
      ...entry,
      amount: "1.5",
      kind: "transfer" as const,
      summary: "Send",
      token: "STRK",
    };
    expect(activityRowModel(sent, pricing).fiat).toBe("−$3.00");
    expect(activityRowModel({ ...sent, summary: "Received" }, pricing).fiat).toBe("+$3.00");
    expect(activityRowModel({ ...sent, token: "strk" }, pricing).fiat).toBe("−$3.00");
    expect(activityRowModel(sent).fiat).toBeNull();
    expect(activityRowModel({ ...sent, token: "XYZ" }, pricing).fiat).toBeNull();
    expect(activityRowModel({ ...sent, networkId: "SN_SEPOLIA" }, pricing).fiat).toBeNull();
    expect(activityRowModel(sent, { ...pricing, prices: {} }).fiat).toBeNull();
    expect(
      activityRowModel(sent, { ...pricing, tokens: [strk, { ...strk, address: "0x7" }] }).fiat,
    ).toBeNull();
    expect(activityRowModel({ ...sent, summary: "Allow spend" }, pricing).fiat).toBeNull();
    // A shield or unshield moves value between the owner's own balances: the
    // figure is priced but carries no sign.
    expect(activityRowModel({ ...sent, summary: "Shield 3 STRK" }, pricing).fiat).toBe("$3.00");
    expect(activityRowModel({ ...sent, summary: "Unshield 3 STRK" }, pricing).fiat).toBe("$3.00");
    expect(
      activityRowModel({ ...sent, summary: "Activate private balances", amount: "" }, pricing).fiat,
    ).toBeNull();
    expect(activityRowModel({ ...sent, amount: "" }, pricing).fiat).toBeNull();
  });

  test("shows the asset amount whenever amount and symbol are recorded, priced or not", () => {
    const model = activityRowModel({ ...entry, amount: "1234.56789", token: "USDC" });
    expect(model.amount).toBe("1,234.5678 USDC");
    expect(model.tokenAddress).toBeNull();
    expect(activityRowModel({ ...entry, amount: "1" }).amount).toBeNull();
    expect(activityRowModel({ ...entry, token: "USDC" }).amount).toBeNull();
  });

  test("prefers the recorded counterparty for the detail line, phrased by direction", () => {
    const party = "0x0123456789abcdef0123456789abcdef";
    const sent = {
      ...entry,
      counterparty: party,
      kind: "transfer" as const,
      summary: "Send 1 STRK",
    };
    expect(activityRowModel(sent).detail).toBe("To 0x0123…cdef");
    expect(activityRowModel({ ...sent, summary: "Received 1 STRK" }).detail).toBe(
      "From 0x0123…cdef",
    );
    expect(activityRowModel({ ...sent, summary: "Allow 0x… to spend" }).detail).toBe(
      "To 0x0123…cdef",
    );
    expect(activityRowModel({ ...sent, kind: "deploy", summary: "Deploy" }).detail).toBe(
      "With 0x0123…cdef",
    );
  });

  test("exposes the full recorded counterparty with the role the detail line uses", () => {
    const party = "0x0123456789abcdef0123456789abcdef";
    const sent = {
      ...entry,
      counterparty: ` ${party} `,
      kind: "transfer" as const,
      summary: "Send",
    };
    expect(activityRowModel(sent).counterparty).toEqual({ address: party, role: "recipient" });
    expect(activityRowModel({ ...sent, summary: "Received" }).counterparty).toEqual({
      address: party,
      role: "sender",
    });
    expect(activityRowModel({ ...sent, summary: "Allow 0x… to spend" }).counterparty).toEqual({
      address: party,
      role: "recipient",
    });
    expect(activityRowModel({ ...sent, kind: "deploy", summary: "Deploy" }).counterparty).toEqual({
      address: party,
      role: "counterparty",
    });
    // No recorded counterparty: the detail comes from the summary, and there is
    // no full address to offer.
    expect(activityRowModel({ ...sent, counterparty: "  " }).counterparty).toBeNull();
    expect(activityRowModel(entry).counterparty).toBeNull();
  });
});
