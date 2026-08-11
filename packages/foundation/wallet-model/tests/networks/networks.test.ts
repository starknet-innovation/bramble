/**
 * Starknet network checks prove field validators reject oversized calldata.
 */
import { expect, test } from "bun:test";

import {
  canonicalFelt,
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

test("pads felts to the 32-byte form a device screen shows, and rejects non-numerics", () => {
  // Same felt, two spellings: the padded form is what a hardware wallet renders
  // and what the user compares against, so it must keep the leading zeros that
  // canonicalFelt drops.
  expect(paddedFelt("0xabc")).toBe(`0x${"0".repeat(61)}abc`);
  expect(canonicalFelt("0xabc")).toBe("0xabc");
  expect(paddedFelt("2748")).toBe(`0x${"0".repeat(61)}abc`);
  const full = "0x0721ef90ad626dc13fb97cdc7e04499ee5fa1007f2c4e1a9439b22fc3755b912";
  expect(paddedFelt(full)).toBe(full);
  expect(paddedFelt("not-a-felt")).toBeNull();
  // Empty string is zero, exactly as canonicalFelt treats it — BigInt's own rule.
  // Deliberately not special-cased: the two helpers must agree on what is
  // numeric, and callers gate on isStarkFieldElement before displaying anything.
  expect(paddedFelt("")).toBe(`0x${"0".repeat(64)}`);
  expect(canonicalFelt("")).toBe("0x0");
});
