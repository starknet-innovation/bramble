/**
 * STRK20 schema checks prove strict action validation and envelope shape guards.
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

describe("strk20 action schemas", () => {
  test("parses each discriminated action variant", () => {
    expect(readStrk20Action({ action: "deposit", amount: "10", token })).toEqual({
      action: "deposit",
      amount: "10",
      token,
    });
    expect(readStrk20Action({ action: "withdraw", amount: "0x0a", token })).toEqual({
      action: "withdraw",
      amount: "0x0a",
      token,
    });
    expect(readStrk20Action({ action: "transfer", amount: "5", recipient, token })).toEqual({
      action: "transfer",
      amount: "5",
      recipient,
      token,
    });
    expect(
      readStrk20Action({
        action: "invoke",
        call: { calldata: ["0x1", "2"], contract_address: token, entry_point: "do_thing" },
      }),
    ).toEqual({
      action: "invoke",
      call: { calldata: ["0x1", "2"], contract_address: token, entry_point: "do_thing" },
    });
  });

  test("rejects malformed or unknown actions", () => {
    expect(readStrk20Action({ action: "burn", amount: "10", token })).toBeNull();
    expect(readStrk20Action({ action: "deposit", amount: "0", token })).toBeNull();
    expect(readStrk20Action({ action: "deposit", amount: "-1", token })).toBeNull();
    expect(readStrk20Action({ action: "deposit", amount: "10", token: "0x0" })).toBeNull();
    expect(readStrk20Action({ action: "deposit", amount: "10", token, extra: 1 })).toBeNull();
    expect(readStrk20Action({ action: "transfer", amount: "5", token })).toBeNull();
    expect(readStrk20Action({ action: "invoke", call: { contract_address: token } })).toBeNull();
    expect(readStrk20Action("deposit")).toBeNull();
  });

  test("enforces minItems on action lists and rejects any bad member", () => {
    expect(readStrk20Actions([])).toBeNull();
    expect(readStrk20Actions("nope")).toBeNull();
    expect(
      readStrk20Actions([
        { action: "deposit", amount: "10", token },
        { action: "burn", amount: "1", token },
      ]),
    ).toBeNull();
    expect(readStrk20Actions([{ action: "deposit", amount: "10", token }])).toHaveLength(1);
  });

  test("parses invoke calls and rejects bad calldata felts", () => {
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
