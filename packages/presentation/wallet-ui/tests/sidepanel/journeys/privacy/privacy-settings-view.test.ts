/**
 * Privacy service settings view coverage for complete routing and safe text.
 */
import { describe, expect, test } from "bun:test";
import { strk20ServicesForm } from "../../../../src/sidepanel/journeys/privacy/privacy-settings-view";

describe("STRK20 privacy service settings view", () => {
  test("renders an empty, credential-free complete-routing form", () => {
    const html = strk20ServicesForm("<Mainnet>", null);

    for (const name of [
      "discoveryUrl",
      "proverUrl",
      "poolAddress",
      "shadowAccountAnonymizerAddress",
      "ohttpRelayUrl",
      "paymasterUrl",
      "feeToken",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).not.toContain('name="apiKey"');
    expect(html).toContain("&lt;Mainnet&gt;");
    expect(html).not.toContain("<Mainnet>");
  });

  test("renders every configured public endpoint and contract", () => {
    const html = strk20ServicesForm("Sepolia", {
      discoveryUrl: "https://discovery.example",
      ohttpRelayUrl: "https://relay.example",
      paymaster: { feeToken: "0x456", url: "https://paymaster.example" },
      poolAddress: "0x123",
      proverUrl: "https://prover.example",
      shadowAccountAnonymizerAddress: "0x789",
    });

    for (const value of [
      "https://discovery.example",
      "https://relay.example",
      "https://paymaster.example",
      "https://prover.example",
      "0x123",
      "0x456",
      "0x789",
    ]) {
      expect(html).toContain(`value="${value}"`);
    }
  });
});
