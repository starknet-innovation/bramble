/**
 * The shadow-account approval card (#443, PR 4): a `shadow_account_invoke`
 * is reviewed as the facts its card must state, not as the site's raw label —
 * the calls, which shadow account and site, the anonymizer, which tokens settle
 * back into private notes, and who can move what the calls leave behind.
 */
import { describe, expect, test } from "bun:test";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import {
  SHADOW_INVOKE_ANONYMIZER,
  SHADOW_INVOKE_COLLECTS_ALL_TO,
  SHADOW_INVOKE_CONTROL,
  SHADOW_INVOKE_RUNS,
  SHADOW_INVOKE_SETTLES,
  SHADOW_INVOKE_SETTLES_NOTHING,
  SHADOW_INVOKE_SETTLES_TO,
} from "../../src/policy/shadow-account-copy";
import { summarizeStrk20Batch } from "../../src/policy/summaries";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const OTHER = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ANONYMIZER = "0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7";
const ACCOUNT = "0x0a11ce";
const shadow = { anonymizer: ANONYMIZER, origin: "https://app.example" };
const assetFor = (token: string) => (token === STRK ? { decimals: 18, symbol: "STRK" } : undefined);

const call = { calldata: ["0x1"], contract_address: OTHER, entry_point: "swap" };
const invoke = (calls: number, nonce = "0x2", collect: "all" | "diff" = "all"): Strk20Action => ({
  calls: Array.from({ length: calls }, () => call),
  collect_policy: { type: collect },
  dapp_name: "Market",
  nonce,
  type: "shadow_account_invoke",
});
const open = (token: string, recipient = ACCOUNT): Strk20Action => ({
  amount: "OPEN",
  recipient,
  token,
  type: "transfer",
});

describe("shadow account invoke review", () => {
  test("states the calls, shadow account, site, anonymizer, settled tokens, and control", () => {
    const summaries = summarizeStrk20Batch([open(STRK), open(OTHER), invoke(3)], {
      assetFor,
      depositor: ACCOUNT,
      shadow,
    });
    expect(summaries.slice(2)).toEqual([
      "Runs 3 calls through your shadow account #2 for https://app.example",
      `Shadow account anonymizer ${ANONYMIZER}`,
      "Settles STRK, 0x012345…cdef back into private notes",
      SHADOW_INVOKE_CONTROL,
    ]);
    // The OPEN transfers keep their own lines, in batch order.
    expect(summaries[0]).toContain("an open note");
    expect(summaries.join("\n")).not.toContain("Market shadow account invoke");
  });

  test("says so when nothing settles back, and counts one call in the singular", () => {
    expect(summarizeStrk20Batch([invoke(1, "0x0")], { shadow })).toEqual([
      SHADOW_INVOKE_RUNS(1, "0", shadow.origin),
      SHADOW_INVOKE_ANONYMIZER(ANONYMIZER),
      SHADOW_INVOKE_SETTLES_NOTHING,
      SHADOW_INVOKE_CONTROL,
    ]);
    expect(SHADOW_INVOKE_RUNS(1, "0", "x")).toContain("1 call through");
  });

  test("an untrusted token is named by its address, never a guessed symbol", () => {
    expect(
      summarizeStrk20Batch([open(OTHER), invoke(1)], { depositor: ACCOUNT, shadow }),
    ).toContain(SHADOW_INVOKE_SETTLES("0x012345…cdef"));
  });

  // Audit F1: "back into private notes" is claimed only for this account's own
  // notes. A note for anyone else names its recipient, and under `all` says the
  // whole shadow-account balance of that token goes to them.
  const STRANGER = "0x0bad000000000000000000000000000000000000000000000000000000000001";
  test("an OPEN note for someone else names them instead of settling back", () => {
    const summaries = summarizeStrk20Batch([open(STRK, STRANGER), invoke(1)], {
      assetFor,
      depositor: ACCOUNT,
      shadow,
    });
    expect(summaries.slice(1, -1)).toEqual([
      SHADOW_INVOKE_RUNS(1, "2", shadow.origin),
      SHADOW_INVOKE_ANONYMIZER(ANONYMIZER),
      SHADOW_INVOKE_SETTLES_TO("STRK", "0x0bad00…0001"),
      SHADOW_INVOKE_COLLECTS_ALL_TO("STRK", "0x0bad00…0001"),
    ]);
    expect(summaries.join("\n")).not.toContain("back into private notes");
    expect(SHADOW_INVOKE_COLLECTS_ALL_TO("STRK", "0x0bad00…0001")).toBe(
      "This shadow account's whole STRK balance goes to 0x0bad00…0001",
    );
  });

  test("diff to someone else names them without the whole-balance line", () => {
    const summaries = summarizeStrk20Batch([open(STRK, STRANGER), invoke(1, "0x2", "diff")], {
      assetFor,
      depositor: ACCOUNT,
      shadow,
    });
    expect(summaries).toContain(SHADOW_INVOKE_SETTLES_TO("STRK", "0x0bad00…0001"));
    expect(summaries.join("\n")).not.toContain("whole");
    expect(summaries.join("\n")).not.toContain("back into private notes");
  });

  test("own and foreign notes in one batch each get their own line", () => {
    const summaries = summarizeStrk20Batch([open(STRK), open(OTHER, STRANGER), invoke(1)], {
      assetFor,
      depositor: ACCOUNT,
      shadow,
    });
    expect(summaries).toContain(SHADOW_INVOKE_SETTLES("STRK"));
    expect(summaries).toContain(SHADOW_INVOKE_SETTLES_TO("0x012345…cdef", "0x0bad00…0001"));
    expect(summaries).toContain(SHADOW_INVOKE_COLLECTS_ALL_TO("0x012345…cdef", "0x0bad00…0001"));
  });

  test("without a proven depositor, no note is claimed as the user's own", () => {
    const summaries = summarizeStrk20Batch([open(STRK), invoke(1)], { assetFor, shadow });
    expect(summaries.join("\n")).not.toContain("back into private notes");
    expect(summaries).toContain(SHADOW_INVOKE_SETTLES_TO("STRK", ACCOUNT));
  });

  test("other actions summarize exactly as before", () => {
    const withdraw: Strk20Action = {
      amount: "0x5",
      recipient: OTHER,
      token: STRK,
      type: "withdraw",
    };
    expect(summarizeStrk20Batch([withdraw], { shadow })).toEqual([
      "Withdraw 0x5 to 0x012345…cdef (0x04718f…938d)",
    ]);
  });
});
