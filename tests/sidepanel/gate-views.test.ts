/** Gate-view markup checks for the staged first-run journey. */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { onboarding } from "../../src/sidepanel/gate-views";

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: false,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

describe("onboarding gate view", () => {
  test("starts with two focused wallet paths", () => {
    const html = onboarding(status);

    expect(html).toContain('data-onboarding-step="welcome"');
    expect(html).toContain('id="create-new-button"');
    expect(html).toContain('id="add-existing-button"');
    expect(html).toContain('class="orbit-field"');
    expect(html.match(/class="orbit-ring/g)?.length).toBe(5);
    expect(html.match(/class="orbit-track/g)?.length).toBe(7);
    expect(html.match(/orbit-track-reverse/g)?.length).toBe(2);
    expect(html.match(/class="orbit-pulse/g)?.length).toBe(3);
    expect(html).not.toContain("orbit-spark");
    expect(html).not.toContain('href="onboarding.html"');
  });

  test("renders focused method, recovery, password, and account stages", () => {
    const html = onboarding(status);

    expect(html).toContain('data-onboarding-step="method"');
    expect(html).toContain('data-onboarding-step="recovery"');
    expect(html).toContain('data-onboarding-step="password"');
    expect(html).toContain('data-onboarding-step="accounts"');
    // The first account is preselected, like every account the scan adds beside
    // it: each row is one the phrase already has, so the user unselects what they
    // do not want rather than opting in one at a time.
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("<strong>Account 1</strong>");
    expect(html.match(/data-recovery-kind="import"/g)?.length).toBe(24);
  });

  test("masks generated words until a deliberate reveal", () => {
    const html = onboarding(status);

    expect(html).toContain('data-recovery-grid="generated"');
    expect(html).toContain("recovery-grid is-masked");
    expect(html).toContain('id="phrase-toggle"');
    expect(html).toContain("Show recovery phrase");
  });

  test("keeps Ledger as a separate keyless path with passphrase confirmation", () => {
    const html = onboarding(status);

    expect(html).toContain('data-onboarding-step="ledger"');
    expect(html).toContain("data-ledger-first-run");
    expect(html).toContain('name="ledgerVaultPassphrase"');
    expect(html).toContain('name="ledgerVaultPassphraseConfirm"');
    expect(html).not.toContain('name="ledgerNetworkId"');
    expect(html).not.toContain('name="networkId"');
  });

  test("keeps first-run setup pinned to Mainnet even if ambient status differs", () => {
    const sepolia: WalletStatus = {
      ...status,
      network: "Starknet Sepolia",
      networkId: "SN_SEPOLIA",
      networks: [{ id: "SN_SEPOLIA", name: "Starknet Sepolia" }],
    };
    const ackRow = onboarding(sepolia).match(/id="ledger-mainnet-ack"[^>]*/)?.[0] ?? "";
    expect(ackRow).not.toContain("hidden");
    expect(onboarding(sepolia)).not.toContain("<select");
  });
});
