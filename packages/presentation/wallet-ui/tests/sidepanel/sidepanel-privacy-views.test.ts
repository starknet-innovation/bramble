/**
 * Privacy journey checkpoints keep public-linkage disclosure and system status
 * visible through activation, shielding, execution, and recovery.
 */
import { describe, expect, test } from "bun:test";
import type { TokenConfig, WalletPreferences } from "@mc-wallet/settings/preferences";
import { account } from "@mc-wallet/testkit/sidepanel";
import type { WalletStatus } from "../../src/popup/responses";
import type { PrivacyPreparation } from "../../src/sidepanel/privacy-runtime";
import { privacyFlow } from "../../src/sidepanel/privacy-views";

const token: TokenConfig = {
  address: "0x456",
  decimals: 18,
  id: "SN_MAIN:ETH:0x456",
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};
const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [token],
};
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
const digest = `sha256:${"a".repeat(64)}`;
const registration: PrivacyPreparation = {
  id: digest,
  kind: "register",
  payloadDigest: digest,
  poolAddress: "0x12345678901234567890",
  route: "public-account",
  summaries: ["Register viewing-key commitment"],
  symbol: "ETH",
  tokenId: token.id,
};
const relayedRegistration: PrivacyPreparation = {
  ...registration,
  authorization: {
    caller: "0x99",
    executeAfter: "0x1",
    executeBefore: "0x100",
    publicCallCount: 1,
  },
  relayFee: { amount: "0x2", recipient: "0x3", token: "0x4" },
  route: "private-relay",
};

describe("privacy journey templates", () => {
  test("activation review discloses its public viewing-key commitment", () => {
    const html = privacyFlow(status, preferences, {
      preparation: registration,
      stage: "activate-review",
      tokenId: token.id,
    });

    expect(html).toContain("Activate private balances");
    expect(html).toContain("Registration is public");
    expect(html).toContain("viewing-key commitment");
  });

  test("a relayed registration discloses its authorization capability", () => {
    const html = privacyFlow(status, preferences, {
      preparation: relayedRegistration,
      stage: "activate-review",
      tokenId: token.id,
    });

    expect(html).toContain("Public approval calls");
    expect(html).toContain("Authorization window");
    expect(html).toContain("Authorization caller");
  });

  test("working, success, failure, and empty checkpoints communicate liveness and recovery", () => {
    const working = privacyFlow(status, preferences, {
      kind: "register",
      preparation: registration,
      stage: "working",
      tokenId: token.id,
    });
    expect(working).toContain("Activating private balances");
    expect(working).toContain("Generate proof and authorize");
    expect(working).toContain("Discover private balance");

    const registered = privacyFlow(status, preferences, {
      hash: "0x12345678901234567890",
      kind: "register",
      stage: "success",
      symbol: "<ETH>",
      tokenId: token.id,
    });
    expect(registered).toContain("Registered");
    // The symbol is escaped, and the next step now points at the asset screen's
    // Shield button rather than a journey of its own.
    expect(registered).toContain("You can now shield &lt;ETH&gt; from its asset screen.");
    expect(registered).toContain('class="send-success-ring"');
    expect(registered).toContain('id="privacy-done"');
    expect(registered).toContain("Back to wallet");

    const failed = privacyFlow(status, preferences, {
      error: "<prover unavailable>",
      stage: "failure",
      tokenId: token.id,
    });
    expect(failed).toContain("&lt;prover unavailable&gt;");
    expect(failed).toContain("No retry was submitted automatically");
    expect(failed).toContain('class="send-failure-ring"');
    expect(failed).toContain('class="send-failure-mark"');
    expect(failed).toContain('id="privacy-retry"');

    expect(privacyFlow(status, preferences, { stage: "idle" })).toContain(
      "Choose an asset to begin",
    );
  });

  test("an untracked token still renders the registration checkpoint", () => {
    // Registration is account-wide, so it does not depend on the token that
    // happened to open it.
    const html = privacyFlow(status, preferences, {
      preparation: registration,
      stage: "activate-review",
      tokenId: "SN_MAIN:MISSING:0x999",
    });

    expect(html).toContain("Activate private balances");
  });
});
