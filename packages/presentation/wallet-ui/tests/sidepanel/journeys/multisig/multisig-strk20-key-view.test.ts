/**
 * The multisig private-balance section names the consequence of the viewing
 * key, and only when this network has a pool.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { multisigStrk20KeyPanel } from "../../../../src/sidepanel/journeys/multisig/multisig-strk20-key-view";

describe("multisig private balances", () => {
  test("says who can see private activity when a pool is configured", () => {
    const html = multisigStrk20KeyPanel("SN_MAIN", defaultWalletPreferences());
    expect(html).toContain("Private balances");
    expect(html).toContain(
      "Anyone with the viewing key can see all of this multisig's private activity.",
    );
    expect(html).toContain("Create key");
    expect(html).toContain("Share key");
    expect(html).toContain("Drop key");
    expect(html).toContain("Register");
    expect(html).toContain("Deposit");
    expect(html).toContain("Transfer");
    expect(html).toContain("Withdraw");
    expect(html).toContain("Send");
    expect(html).toContain("Refresh");
    expect(html).toContain("hidden");
  });

  test("is absent when private balances are not configured", () => {
    const preferences = defaultWalletPreferences();
    const { strk20Networks: _networks, ...rest } = preferences;
    expect(multisigStrk20KeyPanel("SN_MAIN", { ...rest })).toBe("");
    expect(multisigStrk20KeyPanel("SN_SEPOLIA", preferences)).toBe("");
  });
});
