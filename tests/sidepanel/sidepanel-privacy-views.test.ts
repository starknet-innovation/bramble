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

describe("privacy journey templates", () => {
  test("compose shows the tracked public balance, shortcuts, network, and linkage warning", () => {
    const html = privacyFlow(status, preferences, [balance], {
      stage: "compose",
      tokenId: token.id,
    });

    expect(html).toContain('id="privacy-deposit-form"');
    expect(html).toContain("Available to shield");
    expect(html).toContain("2.5 ETH");
    expect(html).toContain('data-privacy-amount="half"');
    expect(html).toContain("Destination network");
    expect(html).toContain("deposit transaction is public");
  });

  test("deposit review freezes amount, route, pool, and escaped summaries", () => {
    const html = privacyFlow(status, preferences, [balance], {
      preparation: deposit,
      stage: "deposit-review",
      tokenId: token.id,
    });

    expect(html).toContain("Shield 1 ETH");
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

    const failed = privacyFlow(status, preferences, [balance], {
      error: "<prover unavailable>",
      stage: "failure",
      tokenId: token.id,
    });
    expect(failed).toContain("&lt;prover unavailable&gt;");
    expect(failed).toContain("No retry was submitted automatically");
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
