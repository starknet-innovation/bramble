/**
 * Unit coverage for the destructive-test gates. Fixtures are deliberately
 * unrelated to any funded account.
 */
import { describe, expect, test } from "bun:test";
import { readStrk20MainnetEnvironment } from "./strk20-mainnet-env";

const valid = (): Record<string, string> => ({
  BRAMBLE_STRK20_E2E_ACCOUNT_ADDRESS: "0x123",
  BRAMBLE_STRK20_E2E_DEPOSIT_STRK: "0.1",
  BRAMBLE_STRK20_E2E_DISCOVERY_URL: "https://discovery.example/",
  BRAMBLE_STRK20_E2E_MAINNET_ACK: "I_UNDERSTAND_THIS_WRITES_TO_MAINNET",
  BRAMBLE_STRK20_E2E_PRIVATE_KEY: "0x456",
  BRAMBLE_STRK20_E2E_PUBLIC_CALLER_ACK: "I_UNDERSTAND_THIS_LINKS_PRIVATE_ACTIONS",
  BRAMBLE_STRK20_E2E_PROVER_URL: "https://prover.example/",
  BRAMBLE_STRK20_E2E_RPC_URL: "https://rpc.example/",
});

describe("STRK20 live-mainnet environment", () => {
  test("normalizes inputs and derives bounded action amounts", () => {
    expect(readStrk20MainnetEnvironment(valid())).toEqual({
      accountAddress: "0x123",
      actionAmount: "0x2386f26fc10000",
      depositAmount: "0.1",
      depositAmountRaw: 100_000_000_000_000_000n,
      discoveryUrl: "https://discovery.example/",
      privateKey: "0x456",
      proverUrl: "https://prover.example/",
      resumeAfterDeposit: false,
      rpcUrl: "https://rpc.example/",
    });
  });

  test("requires an explicit acknowledgement and never echoes a key", () => {
    const env = valid();
    env["BRAMBLE_STRK20_E2E_MAINNET_ACK"] = "no";
    env["BRAMBLE_STRK20_E2E_PRIVATE_KEY"] = "0xsecret";
    expect(() => readStrk20MainnetEnvironment(env)).toThrow("permit mainnet writes");
    try {
      readStrk20MainnetEnvironment(env);
    } catch (error) {
      expect(String(error)).not.toContain("0xsecret");
    }
  });

  test("requires a separate acknowledgement for the public-caller privacy tradeoff", () => {
    const env = valid();
    env["BRAMBLE_STRK20_E2E_PUBLIC_CALLER_ACK"] = "no";
    expect(() => readStrk20MainnetEnvironment(env)).toThrow("public-caller submission");
  });

  test("gates recovery after an already-accepted deposit separately", () => {
    expect(
      readStrk20MainnetEnvironment({
        ...valid(),
        BRAMBLE_STRK20_E2E_RESUME_AFTER_DEPOSIT_ACK: "I_UNDERSTAND_DEPOSIT_ALREADY_SUCCEEDED",
      }).resumeAfterDeposit,
    ).toBe(true);
    expect(() =>
      readStrk20MainnetEnvironment({
        ...valid(),
        BRAMBLE_STRK20_E2E_RESUME_AFTER_DEPOSIT_ACK: "yes",
      }),
    ).toThrow("resume after a confirmed deposit");
  });

  test("rejects CI, invalid secrets, and deposits over the hard cap", () => {
    expect(() => readStrk20MainnetEnvironment({ ...valid(), CI: "true" })).toThrow("local-only");
    expect(() =>
      readStrk20MainnetEnvironment({ ...valid(), BRAMBLE_STRK20_E2E_PRIVATE_KEY: "invalid" }),
    ).toThrow("valid Stark signing key");
    expect(() =>
      readStrk20MainnetEnvironment({
        ...valid(),
        BRAMBLE_STRK20_E2E_DEPOSIT_STRK: "1.000000000000000001",
      }),
    ).toThrow("hard 1 STRK safety cap");
  });

  test("requires HTTPS discovery and proving endpoints without echoing them", () => {
    expect(() =>
      readStrk20MainnetEnvironment({ ...valid(), BRAMBLE_STRK20_E2E_DISCOVERY_URL: "" }),
    ).toThrow("BRAMBLE_STRK20_E2E_DISCOVERY_URL");
    expect(() =>
      readStrk20MainnetEnvironment({
        ...valid(),
        BRAMBLE_STRK20_E2E_PROVER_URL: "http://prover.example/secret",
      }),
    ).toThrow("BRAMBLE_STRK20_E2E_PROVER_URL");
    expect(() =>
      readStrk20MainnetEnvironment({ ...valid(), BRAMBLE_STRK20_E2E_RPC_URL: "" }),
    ).toThrow("BRAMBLE_STRK20_E2E_RPC_URL");
  });

  test("refuses the shared wallet and Foundation RPCs for load-bearing automation", () => {
    for (const rpcUrl of [
      "https://wallet.nodes.starknet.org/rpc/mainnet/v0_10",
      "https://mainnet.nodes.starknet.org/rpc/v0_10",
    ]) {
      expect(() =>
        readStrk20MainnetEnvironment({ ...valid(), BRAMBLE_STRK20_E2E_RPC_URL: rpcUrl }),
      ).toThrow("dedicated test RPC endpoint");
    }
  });

  test("refuses the shared wallet and Foundation RPCs for load-bearing automation", () => {
    for (const rpcUrl of [
      "https://wallet.nodes.starknet.org/rpc/mainnet/v0_10",
      "https://mainnet.nodes.starknet.org/rpc/v0_10",
    ]) {
      expect(() =>
        readStrk20MainnetEnvironment({ ...valid(), MC_STRK20_E2E_RPC_URL: rpcUrl }),
      ).toThrow("dedicated test RPC endpoint");
    }
  });
});
