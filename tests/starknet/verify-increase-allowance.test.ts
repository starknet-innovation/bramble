/**
 * MCW-V09-108: `increase_allowance` and its camelCase dual grant spend exactly
 * as `approve` does, with identical (spender, amount_low, amount_high)
 * calldata. They must decode to the same reviewable summary and raise the same
 * unlimited-approval flag, or a one-word selector change would walk a drainer
 * approval past the wallet's primary anti-drainer control as an opaque
 * "Call increase_allowance on 0x…".
 */
import { describe, expect, test } from "bun:test";
import type { AddressBookEntry, TokenConfig } from "@mc-wallet/settings/preferences";
import { UNLIMITED_ALLOWANCE_THRESHOLD } from "@mc-wallet/transactions/allowance-discovery";
import { memoryAllowanceStore } from "@mc-wallet/transactions/allowance-store";
import { standingAllowanceTotals } from "@mc-wallet/transactions/allowances";
import { verifyCalls } from "@mc-wallet/transactions/verify";
import { isApproveEntrypoint } from "@mc-wallet/transactions/verify-selectors";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { Call } from "starknet";
import { allowanceOwner } from "../../apps/extension/src/background/portfolio/allowance-recording";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = "0x0555aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const tokens: readonly TokenConfig[] = [
  {
    address: ETH,
    decimals: 18,
    id: `SN_MAIN:ETH:${ETH}`,
    name: "Ether",
    networkId: "SN_MAIN",
    symbol: "ETH",
  },
];

const addressBook: readonly AddressBookEntry[] = [];
const context = { account, addressBook, tokens };

const INCREASE_SPELLINGS = ["increase_allowance", "increaseAllowance"] as const;

const increaseCall = (amount: string, high = "0"): Call => ({
  calldata: [SPENDER, amount, high],
  contractAddress: ETH,
  entrypoint: "increase_allowance",
});

describe("increase_allowance spend review", () => {
  test("both spellings decode as an approve with spender and amount", () => {
    for (const entrypoint of INCREASE_SPELLINGS) {
      const report = verifyCalls([{ ...increaseCall("1500000000000000000"), entrypoint }], context);
      const decoded = report.calls[0];

      expect(decoded?.kind).toBe("approve");
      expect(decoded?.entrypoint).toBe(entrypoint);
      // The spender and the amount are both named, so the reviewer sees who is
      // being trusted and for how much.
      expect(decoded?.summary).toContain("Allow 0x555a");
      expect(decoded?.summary).toContain("to spend 1.5 ETH");
      expect(decoded?.summary).not.toContain(`Call ${entrypoint} on`);
    }
  });

  test("an increase is summarized as additive, not as an absolute cap", () => {
    // The resulting allowance is prior + added and is not knowable from the
    // call, so the summary must not read like a limit the wallet verified.
    const report = verifyCalls([increaseCall("1000000000000000000")], context);
    expect(report.calls[0]?.summary).toBe("Allow 0x555a…bbcc to spend 1 ETH more");

    const approved = verifyCalls(
      [{ ...increaseCall("1000000000000000000"), entrypoint: "approve" }],
      context,
    );
    expect(approved.calls[0]?.summary).toBe("Allow 0x555a…bbcc to spend 1 ETH");
  });

  test("both spellings raise the unlimited-approval flag", () => {
    for (const entrypoint of INCREASE_SPELLINGS) {
      // High limb set: an effectively unlimited grant.
      const report = verifyCalls([{ ...increaseCall("0", "1"), entrypoint }], context);
      expect(report.flags.map((flag) => flag.code)).toContain("unlimited-approval");
    }
  });

  test("a bounded increase raises no unlimited-approval flag", () => {
    const report = verifyCalls([increaseCall("1000")], context);
    expect(report.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
  });

  test("increases split across one multicall are judged on their total", () => {
    // Splitting a grant into three increases of 2^127 reaches the same
    // effectively unlimited allowance as one 2^128 approve. Thresholding each
    // call on its own let the split pass with no flag at all.
    const half = (1n << 127n).toString();
    const report = verifyCalls(
      [increaseCall(half), increaseCall(half), increaseCall(half)],
      context,
    );
    expect(report.flags.map((flag) => flag.code)).toContain("unlimited-approval");
    // One generic line, not one per call.
    expect(report.flags.filter((flag) => flag.code === "unlimited-approval")).toHaveLength(1);
  });

  test("increases aggregate per spender and per token, not across them", () => {
    const half = (1n << 127n).toString();
    const otherSpender = verifyCalls(
      [increaseCall(half), { ...increaseCall(half), calldata: ["0x777", half, "0"] }],
      context,
    );
    expect(otherSpender.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");

    const otherToken = verifyCalls(
      [increaseCall(half), { ...increaseCall(half), contractAddress: "0x1234" }],
      context,
    );
    expect(otherToken.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
  });

  test("an approve resets the running total instead of adding to it", () => {
    // `approve` replaces the on-chain allowance, so summing it with the
    // increases around it would invent an unlimited grant that never exists.
    const half = (1n << 127n).toString();
    const report = verifyCalls(
      [increaseCall(half), { ...increaseCall("1"), entrypoint: "approve" }, increaseCall(half)],
      context,
    );
    expect(report.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");

    const repeated = verifyCalls(
      [
        { ...increaseCall(half), entrypoint: "approve" },
        { ...increaseCall(half), entrypoint: "approve" },
      ],
      context,
    );
    expect(repeated.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
  });

  test("a malformed increase falls through to the unknown-call summary", () => {
    // Never invent a spender or amount from calldata that does not carry them.
    const report = verifyCalls(
      [{ calldata: [SPENDER], contractAddress: ETH, entrypoint: "increase_allowance" }],
      context,
    );
    expect(report.calls[0]?.kind).toBe("unknown");
    expect(report.calls[0]?.summary).toContain("Call increase_allowance on");
  });

  test("isApproveEntrypoint matches exactly and claims nothing else", () => {
    expect(isApproveEntrypoint("approve")).toBe(true);
    for (const entrypoint of INCREASE_SPELLINGS) {
      expect(isApproveEntrypoint(entrypoint)).toBe(true);
    }
    for (const entrypoint of [
      "Approve",
      "APPROVE",
      "decrease_allowance",
      "increase_allowances",
      "increase_allowance ",
      "transfer",
      "",
    ]) {
      expect(isApproveEntrypoint(entrypoint)).toBe(false);
    }
  });

  test("a running total that starts at zero cannot see the grant beneath it", () => {
    // Without seeding, the rule is network-free and reads a one-wei top-up as
    // one wei. This is the pre-fix behaviour, kept as the control for the suite
    // below: it is an under-count, so it misses flags but never invents them.
    const report = verifyCalls([increaseCall("1")], context);
    expect(report.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
  });

  test("a decrease_allowance is not dressed up as an approve", () => {
    // Reducing a spender's reach is not a grant; it must not inherit the
    // approve summary or the unlimited flag.
    const report = verifyCalls(
      [{ ...increaseCall("0", "1"), entrypoint: "decrease_allowance" }],
      context,
    );
    expect(report.calls[0]?.kind).toBe("unknown");
    expect(report.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
  });
});

/**
 * The other half of the same finding: a review that judges an increase only
 * against the calls beside it is judging half the transaction. `2^128 - 1`
 * already allowed, plus one wei, is an effectively unlimited allowance on chain
 * — and the card said nothing, because every running total started at zero.
 *
 * The seed comes from the wallet's own allowance log, through the real store, so
 * these pin the shapes the background actually passes rather than a hand-built
 * map.
 */
const JUST_UNDER_UNLIMITED = (UNLIMITED_ALLOWANCE_THRESHOLD - 1n).toString();

const standingFor = async (token: string, accountId = account.id) => {
  const store = memoryAllowanceStore();
  await store.record({
    accountId,
    amount: JUST_UNDER_UNLIMITED,
    networkId: "SN_MAIN",
    spender: SPENDER,
    token,
  });
  return standingAllowanceTotals(await store.list(), allowanceOwner(account), context);
};

describe("standing allowances seed the unlimited-approval total", () => {
  test("an increase of 1 on a known standing 2^128-1 allowance is flagged", async () => {
    const report = verifyCalls([increaseCall("1")], context, await standingFor(ETH));

    expect(report.flags.map((flag) => flag.code)).toContain("unlimited-approval");
  });

  test("a contract the wallet cannot call fungible seeds nothing", async () => {
    // An ERC721 `approve(to, item_id)` is the same three felts, so a record on a
    // contract that is not a tracked token may hold an item id, not an amount.
    // Seeding it would add an id to an amount and invent a warning.
    const unknownContract = "0x0abc123";
    const report = verifyCalls(
      [{ ...increaseCall("1"), contractAddress: unknownContract }],
      context,
      await standingFor(unknownContract),
    );

    expect(report.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
  });

  test("another account's standing allowance is not seeded into this review", async () => {
    const report = verifyCalls(
      [increaseCall("1")],
      context,
      await standingFor(ETH, "SN_MAIN:0x9999"),
    );

    expect(report.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
  });

  // A seed is only a starting point, and the transaction under review may itself
  // pull the allowance back down before it builds on it. Both spellings of the
  // decrease dual have to count, or the same withdrawal reads differently
  // depending on which one the site chose.
  for (const entrypoint of ["decrease_allowance", "decreaseAllowance"] as const) {
    test(`a ${entrypoint} earlier in the multicall lowers what the seed contributes`, async () => {
      const report = verifyCalls(
        [{ ...increaseCall(JUST_UNDER_UNLIMITED), entrypoint }, increaseCall("1")],
        context,
        await standingFor(ETH),
      );

      // The pair ends the transaction holding one wei, so warning about an
      // unlimited grant would be describing a cap that never exists.
      expect(report.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
    });
  }

  test("a decrease does not erase a grant the same transaction still makes", async () => {
    // Withdrawing one wei and re-granting the threshold is still an unlimited
    // grant: the subtraction lowers the running total, it does not excuse it.
    const report = verifyCalls(
      [{ ...increaseCall("1"), entrypoint: "decrease_allowance" }, increaseCall("2")],
      context,
      await standingFor(ETH),
    );

    expect(report.flags.map((flag) => flag.code)).toContain("unlimited-approval");
  });

  test("a decrease is never itself summarized or flagged as a grant", async () => {
    const report = verifyCalls(
      [{ ...increaseCall(JUST_UNDER_UNLIMITED), entrypoint: "decrease_allowance" }],
      context,
      await standingFor(ETH),
    );

    expect(report.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
    expect(report.calls[0]?.kind).toBe("unknown");
  });

  test("an approve REPLACES the standing amount instead of adding to it", async () => {
    // `approve(spender, 1)` lowers the allowance to one wei. Reading the seed as
    // a base to add to would warn about a grant the call is revoking.
    const report = verifyCalls(
      [{ ...increaseCall("1"), entrypoint: "approve" }],
      context,
      await standingFor(ETH),
    );

    expect(report.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
  });
});
