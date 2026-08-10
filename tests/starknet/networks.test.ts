/**
 * Starknet network checks prove field validators reject oversized calldata.
 */
import { expect, test } from "bun:test";

import {
  explorerTransactionUrl,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
  networkIdForChainId,
  STARKNET_NETWORKS,
} from "../../src/starknet/networks";

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
