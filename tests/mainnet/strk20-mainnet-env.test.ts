/**
 * Unit coverage for the destructive-test gates. Fixtures are deliberately
 * unrelated to any funded account.
 */
import { describe, expect, test } from "bun:test";
import { readStrk20MainnetEnvironment } from "./strk20-mainnet-env";

const valid = (): Record<string, string> => ({
  MC_STRK20_E2E_ACCOUNT_ADDRESS: "0x123",
  MC_STRK20_E2E_DEPOSIT_STRK: "0.1",
  MC_STRK20_E2E_MAINNET_ACK: "I_UNDERSTAND_THIS_WRITES_TO_MAINNET",
  MC_STRK20_E2E_PRIVATE_KEY: "0x456",
});

describe("STRK20 live-mainnet environment", () => {
  test("normalizes inputs and derives bounded action amounts", () => {
    expect(readStrk20MainnetEnvironment(valid())).toEqual({
      accountAddress: "0x123",
      actionAmount: "0x2386f26fc10000",
      depositAmount: "0.1",
      depositAmountRaw: 100_000_000_000_000_000n,
      privateKey: "0x456",
    });
  });

  test("requires an explicit acknowledgement and never echoes a key", () => {
    const env = valid();
    env["MC_STRK20_E2E_MAINNET_ACK"] = "no";
    env["MC_STRK20_E2E_PRIVATE_KEY"] = "0xsecret";
    expect(() => readStrk20MainnetEnvironment(env)).toThrow("permit mainnet writes");
    try {
      readStrk20MainnetEnvironment(env);
    } catch (error) {
      expect(String(error)).not.toContain("0xsecret");
    }
  });

  test("rejects CI, invalid secrets, and deposits over the hard cap", () => {
    expect(() => readStrk20MainnetEnvironment({ ...valid(), CI: "true" })).toThrow("local-only");
    expect(() =>
      readStrk20MainnetEnvironment({ ...valid(), MC_STRK20_E2E_PRIVATE_KEY: "invalid" }),
    ).toThrow("valid Stark signing key");
    expect(() =>
      readStrk20MainnetEnvironment({
        ...valid(),
        MC_STRK20_E2E_DEPOSIT_STRK: "1.000000000000000001",
      }),
    ).toThrow("hard 1 STRK safety cap");
  });
});
