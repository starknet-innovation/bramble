/**
 * The token detail screen's own Send and Swap: both are offered whatever the
 * balance and whatever privacy reports, and each names the token it acts on so
 * the binding has no lookup of its own to get wrong.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { tokenDetailFlow } from "../../../../src/sidepanel/journeys/portfolio/token-flows";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const token = defaultWalletPreferences().tokens.find(
  (entry) => entry.networkId === "SN_MAIN" && entry.symbol === "STRK",
);
if (!token) throw new Error("STRK fixture missing");

const balance = { ...token, balance: "1000000000000000000", formatted: "1" };
const noPrivacy: PrivacyDisclosureState = { error: null, loading: false, value: null };

describe("token detail actions", () => {
  test("offers Send and Swap for the token on screen", () => {
    const html = tokenDetailFlow(status, token, balance, [], null, "usd", noPrivacy, true);

    expect(html).toContain(`data-send-token="${token.id}"`);
    expect(html).toContain(`data-swap-token="${token.id}"`);
    expect(html).toContain(">Send<");
    expect(html).toContain(">Swap<");
  });

  test("offers both with no balance at all", () => {
    // A zero balance is discovered on the amount step, as it is from Home —
    // hiding the buttons would make the screen change shape with holdings.
    const html = tokenDetailFlow(status, token, undefined, [], null, "usd", noPrivacy, true);

    expect(html).toContain(`data-send-token="${token.id}"`);
    expect(html).toContain(`data-swap-token="${token.id}"`);
  });

  test("offers both on an account that cannot use private balances", () => {
    // Privacy decides Shield and Unshield below; it has no say over these two.
    const ledger: PrivacyDisclosureState = {
      blockerKind: "ledger",
      error: "Private balances are not available for Ledger accounts",
      loading: false,
      value: null,
    };
    const html = tokenDetailFlow(status, token, balance, [], null, "usd", ledger, false);

    expect(html).toContain(`data-send-token="${token.id}"`);
    expect(html).toContain(`data-swap-token="${token.id}"`);
    expect(html).not.toContain("data-send-shield");
  });
});
