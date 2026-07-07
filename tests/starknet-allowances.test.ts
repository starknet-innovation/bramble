/**
 * Approve-call decoding checks: uint256 amounts, non-approve calls, and the
 * mapping from submitted calls to allowance inputs.
 */
import { describe, expect, test } from "bun:test";
import { approveAllowancesFromCalls, decodeApproveCall } from "../src/starknet/allowances";
import type { AccountRef } from "../src/storage/vault-schema";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

describe("approve call decoding", () => {
  test("decodes an approve into spender and uint256 amount", () => {
    expect(
      decodeApproveCall({
        calldata: ["0x5", "1000", "0"],
        contractAddress: TOKEN,
        entrypoint: "approve",
      }),
    ).toEqual({ amount: 1000n, spender: "0x5" });
  });

  test("combines uint256 high and low limbs", () => {
    const decoded = decodeApproveCall({
      calldata: ["0x5", "0", "1"],
      contractAddress: TOKEN,
      entrypoint: "approve",
    });
    expect(decoded?.amount).toBe(1n << 128n);
  });

  test("ignores non-approve and malformed calls", () => {
    expect(
      decodeApproveCall({
        calldata: ["0x5", "1", "0"],
        contractAddress: TOKEN,
        entrypoint: "transfer",
      }),
    ).toBeNull();
    expect(
      decodeApproveCall({ calldata: ["0x5"], contractAddress: TOKEN, entrypoint: "approve" }),
    ).toBeNull();
  });

  test("maps approve calls to allowance inputs scoped to the account", () => {
    const allowances = approveAllowancesFromCalls(
      [
        { calldata: ["0x5", "1000", "0"], contractAddress: TOKEN, entrypoint: "approve" },
        { calldata: ["0x9", "1", "0"], contractAddress: TOKEN, entrypoint: "transfer" },
      ],
      account,
    );
    expect(allowances).toEqual([
      {
        accountId: account.id,
        amount: "1000",
        networkId: "SN_MAIN",
        spender: "0x5",
        token: TOKEN,
      },
    ]);
  });
});
