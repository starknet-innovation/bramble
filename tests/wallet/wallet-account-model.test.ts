/** Imported/derived account model and index-selection invariants. */
import { describe, expect, test } from "bun:test";
import { nextAccountIndex, sameWalletKey } from "@bramble/vault/accounts";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { isAccountRef } from "@bramble/wallet-model/accounts";

const imported = {
  accountContractType: "openzeppelin",
  address: "0xabc111111",
  classHash: "0x111111",
  derivation: { kind: "imported-raw-key" },
  id: "SN_MAIN:0xabc111111",
  networkId: "SN_MAIN",
  publicKeyX: "0xabc",
};

describe("isAccountRef imported round-trip", () => {
  test("accepts an imported account without publicKeyY", () => {
    expect(isAccountRef(imported)).toBe(true);
  });

  test("rejects imported/derived provenance shape mismatches", () => {
    expect(isAccountRef({ ...imported, publicKeyY: "0xdef" })).toBe(false);
    expect(
      isAccountRef({
        ...imported,
        derivation: { accountIndex: 0, addressIndex: 0, kind: "imported-raw-key" },
      }),
    ).toBe(false);
    expect(
      isAccountRef({
        address: "0xabc111111",
        classHash: "0x111111",
        derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
        id: "SN_MAIN:0xabc111111",
        networkId: "SN_MAIN",
        publicKeyX: "0xabc",
      }),
    ).toBe(false);
  });
});

const bip44Account = (
  publicKeyX: string,
  accountIndex: number,
  addressIndex = 0,
  networkId: "SN_MAIN" | "SN_SEPOLIA" = "SN_MAIN",
): AccountRef => ({
  accountContractType: "openzeppelin",
  address: `0x${publicKeyX.slice(2)}a`,
  classHash: "0x111111",
  derivation: { accountIndex, addressIndex, kind: "starknet-bip44" },
  id: `${networkId}:0x${publicKeyX.slice(2)}a`,
  networkId,
  publicKeyX,
  publicKeyY: "0xdef",
});

const importedAccount = (
  publicKeyX: string,
  networkId: "SN_MAIN" | "SN_SEPOLIA" = "SN_MAIN",
): AccountRef => ({
  accountContractType: "openzeppelin",
  address: `0x${publicKeyX.slice(2)}b`,
  classHash: "0x111111",
  derivation: { kind: "imported-raw-key" },
  id: `${networkId}:0x${publicKeyX.slice(2)}b`,
  networkId,
  publicKeyX,
});

describe("sameWalletKey", () => {
  test("matches HD accounts only at the same derivation position", () => {
    expect(sameWalletKey(bip44Account("0xabc", 0), bip44Account("0xabc", 0))).toBe(true);
    expect(sameWalletKey(bip44Account("0xabc", 0), bip44Account("0xabc", 1))).toBe(false);
    expect(sameWalletKey(bip44Account("0xabc", 0, 0), bip44Account("0xabc", 0, 1))).toBe(false);
    expect(sameWalletKey(bip44Account("0xabc", 0), bip44Account("0xdef", 0))).toBe(false);
  });

  test("matches imported keys without conflating derivation kinds", () => {
    expect(sameWalletKey(importedAccount("0xabc"), importedAccount("0xabc"))).toBe(true);
    expect(sameWalletKey(importedAccount("0xabc"), importedAccount("0xdef"))).toBe(false);
    expect(sameWalletKey(bip44Account("0xabc", 0), importedAccount("0xabc"))).toBe(false);
    expect(sameWalletKey(importedAccount("0xabc"), bip44Account("0xabc", 0))).toBe(false);
  });
});

describe("nextAccountIndex", () => {
  test("returns the target network's lowest unused HD index", () => {
    expect(
      nextAccountIndex(
        [bip44Account("0xa", 0), bip44Account("0xb", 2), importedAccount("0xc")],
        "SN_MAIN",
      ),
    ).toBe(1);
    expect(
      nextAccountIndex(
        [bip44Account("0xa", 0, 0, "SN_MAIN"), bip44Account("0xb", 1, 0, "SN_SEPOLIA")],
        "SN_MAIN",
      ),
    ).toBe(1);
    expect(nextAccountIndex([], "SN_MAIN")).toBe(0);
  });
});
