/**
 * Pre-approval STRK20 batch rules (#443, PR 3): each refused shape is one the
 * pinned SDK or the pool rejects only after the user approved, or where the
 * reviewed shadow account call is not the call that runs. The accepted shapes
 * beside each rule pin that the rule is no wider than its evidence.
 */
import { describe, expect, test } from "bun:test";
import { errorForMessage } from "@bramble/wallet-protocol/rpc-errors";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import {
  STRK20_BATCH_REFUSAL_PREFIX,
  STRK20_BATCH_REFUSALS,
  STRK20_SHADOW_NONCE_UNLISTABLE,
  STRK20_SHADOW_VIEW_NONCE_LIMIT,
  strk20BatchRefusal,
  strk20BatchRefusalError,
  strk20ShadowAccountRefusalError,
} from "@bramble/wallet-protocol/strk20-batch";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const RECIPIENT = "0x0777000000000000000000000000000000000000000000000000000000000abc";
const DEX = "0x0123000000000000000000000000000000000000000000000000000000000def";

const open = (token: string): Strk20Action => ({
  amount: "OPEN",
  recipient: RECIPIENT,
  token,
  type: "transfer",
});
const invoke: Strk20Action = { calldata: ["0x1"], contract: DEX, type: "invoke" };
const shadow = (entry_point = "swap", nonce = "0x1"): Strk20Action => ({
  calls: [{ calldata: ["0x1"], contract_address: DEX, entry_point }],
  collect_policy: { type: "all" },
  dapp_name: "Example",
  nonce,
  type: "shadow_account_invoke",
});
const deposit: Strk20Action = { amount: "0x0a", token: STRK, type: "deposit" };
const withdraw: Strk20Action = {
  amount: "0x0a",
  recipient: RECIPIENT,
  token: STRK,
  type: "withdraw",
};

// Shadow F4: the range view's `end_nonce` is an exclusive u64, so an account at
// nonce 2^64 - 1 or above could never be listed, checked or swept.
describe("unlistable shadow-account nonces", () => {
  const last = `0x${(STRK20_SHADOW_VIEW_NONCE_LIMIT - 1n).toString(16)}`;
  const limit = `0x${STRK20_SHADOW_VIEW_NONCE_LIMIT.toString(16)}`;

  test("pin the bound at 2^64 - 1", () => {
    expect(STRK20_SHADOW_VIEW_NONCE_LIMIT).toBe(2n ** 64n - 1n);
    expect(limit).toBe("0xffffffffffffffff");
  });

  test("refuse a shadow invoke whose nonce the view cannot list", () => {
    expect(strk20BatchRefusal([shadow("swap", last)])).toBeNull();
    expect(strk20BatchRefusal([shadow("swap", limit)])).toBe("unlistableNonce");
    expect(strk20BatchRefusal([shadow("swap", "0x10000000000000000")])).toBe("unlistableNonce");
    expect(strk20BatchRefusal([shadow("swap", "18446744073709551615")])).toBe("unlistableNonce");
    expect(STRK20_BATCH_REFUSALS.unlistableNonce).toBe(STRK20_SHADOW_NONCE_UNLISTABLE);
  });

  test("refuse a commitment request whose nonce the view cannot list", () => {
    expect(strk20ShadowAccountRefusalError(undefined)).toBeNull();
    expect(strk20ShadowAccountRefusalError(last)).toBeNull();
    const refusal = strk20ShadowAccountRefusalError(limit);
    expect(refusal).not.toBeNull();
    expect(errorForMessage(refusal ?? "")).toEqual({
      code: 114,
      data: STRK20_SHADOW_NONCE_UNLISTABLE,
      message: "The request payload is invalid",
    });
  });
});

describe("strk20 batch refusals", () => {
  test("refuse a shadow account call whose entry_point is a 0x selector", () => {
    expect(
      strk20BatchRefusal([
        shadow("0x15d40a3d6ca2ac30f4031e42be28da9b056fef9bb7357ac5e85627ee876e5ad"),
      ]),
    ).toBe("entryPointSelector");
    expect(strk20BatchRefusal([shadow("0X1")])).toBe("entryPointSelector");
    expect(strk20BatchRefusal([shadow("transfer")])).toBeNull();
  });

  test("allow at most one invoke-type action", () => {
    expect(strk20BatchRefusal([invoke, invoke])).toBe("multipleInvokes");
    expect(strk20BatchRefusal([shadow(), shadow()])).toBe("multipleInvokes");
    expect(strk20BatchRefusal([invoke, shadow()])).toBe("multipleInvokes");
    expect(strk20BatchRefusal([invoke])).toBeNull();
    expect(strk20BatchRefusal([withdraw, shadow()])).toBeNull();
  });

  test("an OPEN transfer needs an invoke after it", () => {
    expect(strk20BatchRefusal([open(STRK)])).toBe("openWithoutInvoke");
    expect(strk20BatchRefusal([open(STRK), withdraw])).toBe("openWithoutInvoke");
    expect(strk20BatchRefusal([invoke, open(STRK)])).toBe("openAfterInvoke");
    expect(strk20BatchRefusal([open(STRK), shadow(), open(USDC)])).toBe("openAfterInvoke");
    expect(strk20BatchRefusal([open(STRK), invoke])).toBeNull();
    expect(strk20BatchRefusal([open(STRK), open(USDC), shadow()])).toBeNull();
  });

  test("a shadow account invoke settles at most one OPEN transfer per token", () => {
    expect(strk20BatchRefusal([open(STRK), open(STRK), shadow()])).toBe("openPerToken");
    // The same token spelled with and without leading zeros is still one token.
    expect(strk20BatchRefusal([open(STRK), open(`0x${STRK.slice(3)}`), shadow()])).toBe(
      "openPerToken",
    );
    // The anonymizer's one-note-per-token rule does not bind a plain invoke.
    expect(strk20BatchRefusal([open(STRK), open(STRK), invoke])).toBeNull();
  });

  test("a public deposit cannot share a batch with a settling shadow account invoke", () => {
    expect(strk20BatchRefusal([deposit, open(STRK), shadow()])).toBe("multipleScreeningSubjects");
    // Without an open note nothing settles, so there is only one subject.
    expect(strk20BatchRefusal([deposit, shadow()])).toBeNull();
    // A plain invoke's depositor policy is not known before a chain read.
    expect(strk20BatchRefusal([deposit, open(STRK), invoke])).toBeNull();
  });

  test("leave batches without invoke-type actions alone", () => {
    expect(strk20BatchRefusal([deposit])).toBeNull();
    expect(strk20BatchRefusal([withdraw, { ...withdraw, token: USDC }])).toBeNull();
  });

  test("name the rule after the shared prefix", () => {
    expect(strk20BatchRefusalError([invoke])).toBeNull();
    expect(strk20BatchRefusalError([invoke, invoke])).toBe(
      `${STRK20_BATCH_REFUSAL_PREFIX}${STRK20_BATCH_REFUSALS.multipleInvokes}`,
    );
  });
});
