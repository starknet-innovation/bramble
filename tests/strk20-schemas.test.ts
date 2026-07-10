/**
 * STRK20 schema checks prove strict, spec-0.10.3 action validation and envelope
 * shape guards. These exercise the request/response conformance surface (the
 * `type`-discriminated action union, required recipient, "OPEN" transfer, flat
 * invoke with placeholder calldata) and result shapes — not a live
 * zero-knowledge proof round-trip, which is not runnable in CI here.
 */
import { describe, expect, test } from "bun:test";
import {
  isStrk20BalanceEntry,
  isStrk20CallAndProof,
  isStrk20Proof,
  readStrk20Action,
  readStrk20Actions,
  readStrk20InvokeCall,
  readStrk20Tokens,
} from "../src/starknet/strk20/schemas";

const token = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const recipient = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// Assembles the spec's literal calldata placeholder strings (e.g. `${poolAddress}`)
// that the wallet resolves during action assembly. Built by interpolation so the
// source carries no bare "${" token to be read as a stray template placeholder.
const placeholder = (body: string): string => `${"$"}{${body}}`;

describe("strk20 action schemas", () => {
  test("parses each type-discriminated action variant", () => {
    expect(readStrk20Action({ amount: "0x0a", token, type: "deposit" })).toEqual({
      amount: "0x0a",
      token,
      type: "deposit",
    });
    expect(readStrk20Action({ amount: "0x0a", recipient, token, type: "withdraw" })).toEqual({
      amount: "0x0a",
      recipient,
      token,
      type: "withdraw",
    });
    expect(readStrk20Action({ amount: "0x05", recipient, token, type: "transfer" })).toEqual({
      amount: "0x05",
      recipient,
      token,
      type: "transfer",
    });
  });

  test("accepts a transfer with the literal OPEN amount", () => {
    expect(readStrk20Action({ amount: "OPEN", recipient, token, type: "transfer" })).toEqual({
      amount: "OPEN",
      recipient,
      token,
      type: "transfer",
    });
    // "OPEN" is only valid for transfer, never deposit/withdraw.
    expect(readStrk20Action({ amount: "OPEN", token, type: "deposit" })).toBeNull();
    expect(readStrk20Action({ amount: "OPEN", recipient, token, type: "withdraw" })).toBeNull();
  });

  test("parses a flat invoke action with felt and placeholder calldata", () => {
    const calldata = ["0x1", placeholder("openNoteIds[0]"), placeholder("poolAddress")];
    expect(readStrk20Action({ calldata, contract: token, type: "invoke" })).toEqual({
      calldata,
      contract: token,
      type: "invoke",
    });
    // A flat invoke with empty calldata is well-formed.
    expect(readStrk20Action({ calldata: [], contract: token, type: "invoke" })).toEqual({
      calldata: [],
      contract: token,
      type: "invoke",
    });
  });

  test("requires recipient on withdraw", () => {
    expect(readStrk20Action({ amount: "0x0a", token, type: "withdraw" })).toBeNull();
    expect(
      readStrk20Action({ amount: "0x0a", recipient: "0x0", token, type: "withdraw" }),
    ).toBeNull();
  });

  test("rejects the old `action`-discriminated wire shape", () => {
    expect(readStrk20Action({ action: "deposit", amount: "0x0a", token })).toBeNull();
    expect(readStrk20Action({ action: "withdraw", amount: "0x0a", token })).toBeNull();
    expect(
      readStrk20Action({
        action: "invoke",
        call: { calldata: ["0x1"], contract_address: token, entry_point: "run" },
      }),
    ).toBeNull();
  });

  test("rejects the old nested invoke.call shape and stray entry_point", () => {
    expect(
      readStrk20Action({
        call: { calldata: ["0x1"], contract_address: token, entry_point: "run" },
        type: "invoke",
      }),
    ).toBeNull();
    expect(
      readStrk20Action({
        calldata: ["0x1"],
        contract: token,
        entry_point: "run",
        type: "invoke",
      }),
    ).toBeNull();
  });

  test("rejects malformed or unknown actions", () => {
    expect(readStrk20Action({ amount: "0x0a", token, type: "burn" })).toBeNull();
    expect(readStrk20Action({ amount: "10", token, type: "deposit" })).toBeNull();
    expect(readStrk20Action({ amount: "-1", token, type: "deposit" })).toBeNull();
    expect(readStrk20Action({ amount: "0x0a", token: "0x0", type: "deposit" })).toBeNull();
    expect(readStrk20Action({ amount: "0x0a", extra: 1, token, type: "deposit" })).toBeNull();
    expect(readStrk20Action({ amount: "0x05", token, type: "transfer" })).toBeNull();
    expect(
      readStrk20Action({ calldata: ["not-a-felt"], contract: token, type: "invoke" }),
    ).toBeNull();
    expect(
      readStrk20Action({
        calldata: [placeholder("unknownPlaceholder")],
        contract: token,
        type: "invoke",
      }),
    ).toBeNull();
    expect(readStrk20Action("deposit")).toBeNull();
  });

  test("enforces minItems on action lists and rejects any bad member", () => {
    expect(readStrk20Actions([])).toBeNull();
    expect(readStrk20Actions("nope")).toBeNull();
    expect(
      readStrk20Actions([
        { amount: "0x0a", token, type: "deposit" },
        { amount: "0x1", token, type: "burn" },
      ]),
    ).toBeNull();
    expect(readStrk20Actions([{ amount: "0x0a", token, type: "deposit" }])).toHaveLength(1);
  });

  test("parses result-side INVOKE_CALLs and rejects bad calldata felts", () => {
    expect(
      readStrk20InvokeCall({ calldata: ["0x1"], contract_address: token, entry_point: "run" }),
    ).not.toBeNull();
    expect(
      readStrk20InvokeCall({ calldata: ["nope"], contract_address: token, entry_point: "run" }),
    ).toBeNull();
    expect(
      readStrk20InvokeCall({ calldata: [], contract_address: "0x0", entry_point: "run" }),
    ).toBeNull();
  });

  test("validates the token list for balances queries", () => {
    expect(readStrk20Tokens([token, recipient])).toEqual([token, recipient]);
    expect(readStrk20Tokens([])).toBeNull();
    expect(readStrk20Tokens([token, "0x0"])).toBeNull();
  });
});

describe("strk20 envelope schemas", () => {
  test("guards the proof, call-and-proof, and balance entry shapes", () => {
    const proof = { data: "abc", output: ["0x1"], proof_facts: ["0x2"] };
    expect(isStrk20Proof(proof)).toBe(true);
    expect(isStrk20Proof({ data: "", output: ["0x1"], proof_facts: [] })).toBe(false);
    expect(isStrk20Proof({ data: "abc", output: ["nope"], proof_facts: [] })).toBe(false);

    const call = { calldata: ["0x1"], contract_address: token, entry_point: "run" };
    expect(isStrk20CallAndProof({ call, proof })).toBe(true);
    expect(isStrk20CallAndProof({ call })).toBe(false);
    expect(isStrk20CallAndProof({ call, proof: { data: "x" } })).toBe(false);

    expect(isStrk20BalanceEntry({ balance: "0x64", token })).toBe(true);
    expect(isStrk20BalanceEntry({ balance: "0x64", token: "0x0" })).toBe(false);
    expect(isStrk20BalanceEntry({ balance: "10", token })).toBe(false);
  });
});
