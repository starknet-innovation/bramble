/**
 * Preference message parser checks reject malformed display-setting envelopes
 * before they reach the preferences store.
 */
import { describe, expect, test } from "bun:test";
import {
  readSetDisplayInput,
  readSetStrk20NetworkConfigInput,
} from "../../../apps/extension/src/background/settings/preference-inputs";

describe("readSetDisplayInput", () => {
  test("reads a well-formed display-settings message", () => {
    expect(
      readSetDisplayInput({
        approvalSurface: "popup",
        displayCurrency: "eur",
        reliabilityDiagnostics: true,
        theme: "dark",
        type: "wallet.setDisplay",
      }),
    ).toEqual({
      approvalSurface: "popup",
      displayCurrency: "eur",
      reliabilityDiagnostics: true,
      theme: "dark",
    });
  });

  test("rejects a non-record, wrong-type, or unknown-key envelope", () => {
    expect(readSetDisplayInput(null)).toBeNull();
    expect(readSetDisplayInput({ theme: "dark", type: "wallet.setRpcOverride" })).toBeNull();
    expect(
      readSetDisplayInput({ debug: true, theme: "dark", type: "wallet.setDisplay" }),
    ).toBeNull();
  });

  test("rejects unknown currency or theme values", () => {
    expect(
      readSetDisplayInput({ approvalSurface: "window", type: "wallet.setDisplay" }),
    ).toBeNull();
    expect(readSetDisplayInput({ displayCurrency: "jpy", type: "wallet.setDisplay" })).toBeNull();
    expect(readSetDisplayInput({ theme: "solarized", type: "wallet.setDisplay" })).toBeNull();
    expect(
      readSetDisplayInput({ reliabilityDiagnostics: "yes", type: "wallet.setDisplay" }),
    ).toBeNull();
  });
});

describe("readSetStrk20NetworkConfigInput", () => {
  const config = {
    discoveryUrl: "https://privacy.example/discovery",
    ohttpRelayUrl: "https://privacy.example/ohttp",
    paymaster: { feeToken: "0x5", url: "https://privacy.example/paymaster" },
    poolAddress: "0x2",
    proverUrl: "https://privacy.example/prover",
    subaccountAnonymizerAddress: "0x3",
  };

  test("accepts only complete, per-network public service routing", () => {
    expect(
      readSetStrk20NetworkConfigInput({
        config,
        networkId: "SN_MAIN",
        type: "wallet.setStrk20NetworkConfig",
      }),
    ).toEqual({ config, networkId: "SN_MAIN" });
    expect(
      readSetStrk20NetworkConfigInput({
        config: null,
        networkId: "SN_MAIN",
        type: "wallet.setStrk20NetworkConfig",
      }),
    ).toEqual({ config: null, networkId: "SN_MAIN" });
  });

  test("rejects partial routing, credentials, and insecure remote URLs", () => {
    expect(
      readSetStrk20NetworkConfigInput({
        config: { discoveryUrl: config.discoveryUrl },
        networkId: "SN_MAIN",
        type: "wallet.setStrk20NetworkConfig",
      }),
    ).toBeNull();
    expect(
      readSetStrk20NetworkConfigInput({
        config: { ...config, apiKey: "secret" },
        networkId: "SN_MAIN",
        type: "wallet.setStrk20NetworkConfig",
      }),
    ).toBeNull();
    expect(
      readSetStrk20NetworkConfigInput({
        config: { ...config, proverUrl: "http://privacy.example/prover" },
        networkId: "SN_MAIN",
        type: "wallet.setStrk20NetworkConfig",
      }),
    ).toBeNull();
  });
});
