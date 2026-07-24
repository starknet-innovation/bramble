/**
 * decodeCall fallback arm: a transfer/approve call whose calldata has the right
 * arity but no decodable (amount, counterparty) pair does not return the token
 * summary — it falls through to the generic "unknown" summary rather than
 * mislabelling the call.
 */
import { describe, expect, test } from "bun:test";
import { verifyCalls } from "../../src/starknet/verify";
import type { AccountRef } from "../../src/storage/vault-schema";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const context = { account, addressBook: [], tokens: [] };

describe("decodeCall transfer/approve fallback", () => {
  test("an approve with enough felts but an empty counterparty falls back to unknown", () => {
    const report = verifyCalls(
      [{ calldata: ["", "5", "0"], contractAddress: ETH, entrypoint: "approve" }],
      context,
    );

    expect(report.calls[0]?.kind).toBe("unknown");
    expect(report.calls[0]?.summary).toContain("Call approve on");
  });

  test("a transfer whose amount felts are unparseable also falls back to unknown", () => {
    const report = verifyCalls(
      [{ calldata: ["0xdead", "not-a-felt", "0"], contractAddress: ETH, entrypoint: "transfer" }],
      context,
    );

    expect(report.calls[0]?.kind).toBe("unknown");
    expect(report.calls[0]?.summary).toContain("Call transfer on");
  });
});
