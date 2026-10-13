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
  SHADOW_INVOKE_CONTROL,
  SHADOW_INVOKE_RUNS,
  SHADOW_INVOKE_SETTLES,
  SHADOW_INVOKE_SETTLES_NOTHING,
} from "../../src/policy/shadow-account-copy";
import { summarizeStrk20Batch } from "../../src/policy/summaries";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const OTHER = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ANONYMIZER = "0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7";
const ACCOUNT = "0x0a11ce";
const shadow = { anonymizer: ANONYMIZER, origin: "https://app.example" };
const assetFor = (token: string) => (token === STRK ? { decimals: 18, symbol: "STRK" } : undefined);

const call = { calldata: ["0x1"], contract_address: OTHER, entry_point: "swap" };
const invoke = (calls: number, nonce = "0x2"): Strk20Action => ({
  calls: Array.from({ length: calls }, () => call),
  collect_policy: { type: "all" },
  dapp_name: "Market",
  nonce,
  type: "shadow_account_invoke",
});
const open = (token: string): Strk20Action => ({
  amount: "OPEN",
  recipient: ACCOUNT,
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
    expect(summarizeStrk20Batch([open(OTHER), invoke(1)], { shadow })).toContain(
      SHADOW_INVOKE_SETTLES("0x012345…cdef"),
    );
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
