/**
 * Entrypoint names that are also Object.prototype keys (Sherlock 193).
 *
 * The decoder table is a plain object, so a call naming `toString`,
 * `constructor` or `__proto__` must still decode as an unknown call with the
 * generic summary. Before the fix, `toString` resolved to
 * Object.prototype.toString and returned a string where a decoded call was
 * expected, which broke every surface that renders the call, including the
 * multisig detail screen a co-signer's intent opens on.
 */
import { describe, expect, test } from "bun:test";
import { verifyCalls } from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";

const CONTRACT = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const context = { account, addressBook: [], tokens: [] };

describe("entrypoints named like Object.prototype keys", () => {
  for (const entrypoint of [
    "toString",
    "constructor",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
    "isPrototypeOf",
  ]) {
    test(`${entrypoint} decodes as an unknown call with a summary`, () => {
      const report = verifyCalls(
        [{ calldata: ["0x1", "0x2"], contractAddress: CONTRACT, entrypoint }],
        context,
      );
      const call = report.calls[0];
      expect(call?.kind).toBe("unknown");
      expect(call?.entrypoint).toBe(entrypoint);
      expect(typeof call?.summary).toBe("string");
      expect(call?.summary).toContain(`Call ${entrypoint} on`);
    });
  }
});
