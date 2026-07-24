/**
 * First-run real-funds acknowledgement gate: creating a wallet on Starknet
 * Mainnet requires the acknowledgement, while testnets skip it.
 */
import { describe, expect, test } from "bun:test";
import {
  MAINNET_NETWORK_ID,
  mainnetAckSatisfied,
  requiresMainnetAck,
} from "../../src/sidepanel/mainnet-ack";

describe("requiresMainnetAck", () => {
  test("only Starknet Mainnet requires the acknowledgement", () => {
    expect(MAINNET_NETWORK_ID).toBe("SN_MAIN");
    expect(requiresMainnetAck("SN_MAIN")).toBe(true);
    expect(requiresMainnetAck("SN_SEPOLIA")).toBe(false);
    expect(requiresMainnetAck("SN_DEVNET")).toBe(false);
    expect(requiresMainnetAck("")).toBe(false);
  });
});

describe("mainnetAckSatisfied", () => {
  test("mainnet only passes once acknowledged", () => {
    expect(mainnetAckSatisfied("SN_MAIN", false)).toBe(false);
    expect(mainnetAckSatisfied("SN_MAIN", true)).toBe(true);
  });

  test("testnets pass regardless of the acknowledgement", () => {
    expect(mainnetAckSatisfied("SN_SEPOLIA", false)).toBe(true);
    expect(mainnetAckSatisfied("SN_SEPOLIA", true)).toBe(true);
    expect(mainnetAckSatisfied("SN_DEVNET", false)).toBe(true);
    expect(mainnetAckSatisfied("SN_DEVNET", true)).toBe(true);
  });
});
