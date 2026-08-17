/**
 * Starknet network checks prove field validators reject oversized calldata.
 */
import { expect, test } from "bun:test";

import {
  canonicalAddress,
  explorerTransactionUrl,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
  networkIdForChainId,
  paddedFelt,
  STARKNET_NETWORKS,
} from "@mc-wallet/wallet-model/networks";

test("validates bounded Stark field elements", () => {
  expect(isStarkFieldElement("0x1")).toBe(true);
  expect(isNonZeroStarkFieldElement("0x1")).toBe(true);
  expect(isNonZeroStarkFieldElement("0x0")).toBe(false);
  expect(isStarkFieldElement("0xABC")).toBe(false);
  expect(
    isStarkFieldElement("0x800000000000011000000000000000000000000000000000000000000000001"),
  ).toBe(false);
  expect(isStarkFieldElement(`0x${"0".repeat(64)}1`)).toBe(false);
});

test("validates Starknet network ids by owned configured keys only", () => {
  expect(isStarknetNetworkId("SN_SEPOLIA")).toBe(true);
  expect(isStarknetNetworkId("toString")).toBe(false);
});

test("gives every network a distinct chain id so devnet never aliases Sepolia", () => {
  const chainIds = Object.values(STARKNET_NETWORKS).map((network) => network.chainId);
  expect(new Set(chainIds).size).toBe(chainIds.length);
  expect(STARKNET_NETWORKS.SN_DEVNET.chainId).not.toBe(STARKNET_NETWORKS.SN_SEPOLIA.chainId);
});

test("resolves each configured chain id deterministically to its network", () => {
  expect(networkIdForChainId(STARKNET_NETWORKS.SN_MAIN.chainId)).toBe("SN_MAIN");
  expect(networkIdForChainId(STARKNET_NETWORKS.SN_SEPOLIA.chainId)).toBe("SN_SEPOLIA");
  expect(networkIdForChainId(STARKNET_NETWORKS.SN_DEVNET.chainId)).toBe("SN_DEVNET");
  expect(networkIdForChainId("0xdeadbeef")).toBeNull();
});

test("links transactions to each network's explorer, and never to a missing one", () => {
  expect(explorerTransactionUrl("SN_MAIN", "0x123")).toBe("https://starkscan.co/tx/0x123");
  expect(explorerTransactionUrl("SN_SEPOLIA", "0x123")).toBe(
    "https://sepolia.starkscan.co/tx/0x123",
  );
  // Devnet has no public explorer, so callers must render no link at all.
  expect(explorerTransactionUrl("SN_DEVNET", "0x123")).toBeNull();
  // A malformed or zero hash never becomes a URL.
  expect(explorerTransactionUrl("SN_MAIN", "0x0")).toBeNull();
  expect(explorerTransactionUrl("SN_MAIN", "not-a-hash")).toBeNull();
  expect(explorerTransactionUrl("SN_MAIN", "0xABC")).toBeNull();
});

test("pads a felt to the fixed 64-digit width a Ledger receives and displays", () => {
  // The device library strips `0x` and leading zeros, then left-pads back to 64
  // digits before the APDU. Rendering anything narrower in the panel would ask a
  // user to compare two different spellings of the same number.
  expect(paddedFelt("0xabc")).toBe(`0x${"abc".padStart(64, "0")}`);
  // The field prime is 63 hex digits, so no felt reaches 64 and EVERY padded
  // value is exactly 64 digits — a widest-possible felt still gains one leading
  // zero. A test stubbing a short hash would never catch a narrower rendering.
  const widest = `0x${"7".repeat(63)}`;
  expect(isStarkFieldElement(widest)).toBe(true);
  expect(paddedFelt(widest)).toBe(`0x0${"7".repeat(63)}`);
  for (const value of ["0xabc", widest, "0x0"]) {
    expect(paddedFelt(value)).toHaveLength(66);
  }
  // Zero is a felt: a hash carries no non-zero invariant, unlike an address.
  expect(paddedFelt("0x0")).toBe(`0x${"0".repeat(64)}`);
  expect(canonicalAddress("0x0")).toBeNull();
  // Mixed case and surrounding whitespace normalize to one comparable spelling.
  expect(paddedFelt("  0xABC  ")).toBe(paddedFelt("0xabc"));
  // Anything that is not a field element reports null rather than throwing.
  expect(paddedFelt("not-a-hash")).toBeNull();
  expect(paddedFelt("")).toBeNull();
  expect(paddedFelt(`0x${"f".repeat(64)}`)).toBeNull();
});

test("canonical addresses keep their non-zero rule while sharing one padding", () => {
  // 54 digits: canonicalization widens it to the same 64 the hash display uses.
  const address = `0x${"1234567890abcdef".repeat(3)}abcdef`;
  expect(canonicalAddress(address)).toBe(paddedFelt(address));
  expect(canonicalAddress(address)).toHaveLength(66);
  expect(canonicalAddress("0xABC")).toBe(paddedFelt("0xabc"));
  expect(canonicalAddress("not-an-address")).toBeNull();
});
