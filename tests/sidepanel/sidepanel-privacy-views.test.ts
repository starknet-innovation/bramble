/**
 * Privacy journey checkpoints keep public-linkage disclosure and system status
 * visible through activation, shielding, execution, and recovery.
 */
import { describe, expect, test } from "bun:test";
import type { TokenBalance, WalletStatus } from "../../src/popup/responses";
import type { PrivacyPreparation } from "../../src/sidepanel/privacy-runtime";
import { privacyFlow } from "../../src/sidepanel/privacy-views";
import type { TokenConfig, WalletPreferences } from "../../src/storage/preferences-store";
import { account } from "../support/sidepanel-fixtures";

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
const balance: TokenBalance = {
  ...token,
  balance: "2500000000000000000",
  formatted: "2.5",
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
const deposit: PrivacyPreparation = {
  amount: "1",
  id: digest,
  kind: "deposit",
  payloadDigest: digest,
  poolAddress: "0x12345678901234567890",
  route: "public-account",
  summaries: ["Shield <one> ETH", "Public account fee"],
  symbol: "ETH",
  tokenId: token.id,
};
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
const relayedDeposit: PrivacyPreparation = {
  ...deposit,
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
  test("compose is a swap-style card with public/private panels and a flip", () => {
    const html = privacyFlow(
      status,
      preferences,
      [balance],
      { stage: "compose", tokenId: token.id },
      {
        error: null,
        loading: false,
        value: {
          accountId: account.id,
          balances: [
            {
              balance: "0x6f05b59d3b20000",
              formatted: "0.5",
              symbol: "ETH",
              token: token.address,
              tokenId: token.id,
            },
          ],
          networkId: "SN_MAIN",
          registration: "registered",
        },
      },
    );

    expect(html).toContain('id="privacy-deposit-form"');
    // Swap-style card: labelled panels replace the sell/buy sides, the source
    // owns the input and Max, the destination is an output.
    expect(html).toContain('class="swap-card"');
    expect(html).toContain('data-privacy-side-label="source">Public balance');
    expect(html).toContain('data-privacy-side-label="destination">Private balance');
    expect(html).toContain('data-privacy-side-balance="source">2.5');
    expect(html).toContain('data-privacy-side-balance="destination">0.5');
    expect(html).toContain('id="privacy-result-amount"');
    expect(html).toContain('class="swap-max"');
    expect(html).toContain('id="privacy-flip"');
    expect(html).toContain('data-direction="shield"');
    expect(html).toContain("Review shielding");
    // Withdrawal address only exists for the unshield direction.
    expect(html).toContain("data-privacy-recipient-row hidden");
    // The old cluttered wording is gone.
    expect(html).not.toContain("Available to shield");
    expect(html).not.toContain("Destination network");
    expect(html).not.toContain("deposit transaction is public");
    // The header names the direction.
    expect(html).toContain("<h1>Shield</h1>");
  });

  test("deposit review freezes amount, route, pool, and escaped summaries", () => {
    const html = privacyFlow(status, preferences, [balance], {
      preparation: deposit,
      stage: "deposit-review",
      tokenId: token.id,
    });

    expect(html).toContain("Shield 1 ETH");
    // The review amount is editable so it can be corrected before confirming.
    expect(html).toContain('id="privacy-review-amount"');
    expect(html).toContain('name="reviewAmount"');
    expect(html).toContain('value="1"');
    expect(html).toContain("Public account transaction");
    expect(html).toContain("0x123456…67890");
    expect(html).toContain("Shield &lt;one&gt; ETH");
    expect(html).toContain("Shielding is a public deposit");
    expect(html).toContain('id="privacy-confirm"');
  });

  test("activation review discloses its public viewing-key commitment", () => {
    const html = privacyFlow(status, preferences, [balance], {
      preparation: registration,
      stage: "activate-review",
      tokenId: token.id,
    });

    expect(html).toContain("Activate private balances");
    expect(html).toContain("Registration is public");
    expect(html).toContain("viewing-key commitment");
  });

  test("private relay review shows exact fee and authorization capability", () => {
    const html = privacyFlow(status, preferences, [balance], {
      preparation: relayedDeposit,
      stage: "deposit-review",
      tokenId: token.id,
    });

    expect(html).toContain("Relay fee");
    expect(html).toContain("Fee recipient");
    expect(html).toContain("Public approval calls");
    expect(html).toContain("Authorization window");
    expect(html).toContain("Authorization caller");
  });

  test("working, success, failure, and empty checkpoints communicate liveness and recovery", () => {
    const working = privacyFlow(status, preferences, [balance], {
      kind: "deposit",
      preparation: deposit,
      stage: "working",
      tokenId: token.id,
    });
    expect(working).toContain("Shielding your asset");
    expect(working).toContain("Generate proof and authorize");
    expect(working).toContain("Discover private balance");

    const registered = privacyFlow(status, preferences, [balance], {
      hash: "0x12345678901234567890",
      kind: "register",
      stage: "success",
      symbol: "ETH",
      tokenId: token.id,
    });
    expect(registered).toContain("Activation accepted");
    expect(registered).toContain('class="send-success-ring"');
    expect(registered).toContain('class="send-success-check"');
    expect(registered).toContain('id="privacy-check-activation"');

    const shielded = privacyFlow(status, preferences, [balance], {
      hash: "0x12345678901234567890",
      kind: "deposit",
      stage: "success",
      symbol: "<ETH>",
      tokenId: token.id,
    });
    expect(shielded).toContain("&lt;ETH&gt; shielding accepted");
    expect(shielded).toContain('id="privacy-check-balance"');
    expect(shielded).toContain('id="privacy-done"');
    expect(shielded).toContain("Back to wallet");
    expect(shielded).not.toContain("Back to asset");

    const failed = privacyFlow(status, preferences, [balance], {
      error: "<prover unavailable>",
      stage: "failure",
      tokenId: token.id,
    });
    expect(failed).toContain("&lt;prover unavailable&gt;");
    expect(failed).toContain("No retry was submitted automatically");
    expect(failed).toContain('class="send-failure-ring"');
    expect(failed).toContain('class="send-failure-mark"');
    expect(failed).toContain('id="privacy-retry"');

    expect(privacyFlow(status, preferences, [balance], { stage: "idle" })).toContain(
      "Choose an asset to begin",
    );
  });

  test("missing tracked token renders a stable empty state", () => {
    const html = privacyFlow(status, preferences, [balance], {
      stage: "compose",
      tokenId: "SN_MAIN:MISSING:0x999",
    });

    expect(html).toContain("no longer tracked");
    expect(html).not.toContain('id="privacy-deposit-form"');
  });
});
