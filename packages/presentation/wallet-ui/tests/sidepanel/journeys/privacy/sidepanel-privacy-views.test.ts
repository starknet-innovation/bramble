/**
 * Privacy journey checkpoints keep public-linkage disclosure and system status
 * visible through activation, shielding, execution, and recovery.
 */
import { describe, expect, test } from "bun:test";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type { PrivacyBlockerKind } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import type { PrivacyPreparation } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import { privacyFlow } from "../../../../src/sidepanel/journeys/privacy/privacy-views";

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

  test("the preparing screen names its step, the job's progress, and the way back", () => {
    const discovering = privacyFlow(status, preferences, {
      progress: null,
      stage: "preparing",
      step: "discovering",
      tokenId: token.id,
    });
    expect(discovering).toContain("Go private");
    expect(discovering).toContain('data-privacy-preparing="discovering"');
    expect(discovering).toContain("Checking private balances");
    expect(discovering).toContain('id="privacy-liveness"');
    expect(discovering).toContain('id="privacy-cancel"');
    // The proof has not started: its step is still pending.
    expect(discovering).toContain('<li data-state="active"><span></span>Check registration');
    expect(discovering).toContain('<li data-state="pending"><span></span>Build registration proof');

    const proving = privacyFlow(status, preferences, {
      progress: { attempt: 2, attempts: 3, elapsedMs: 95_000, phase: "proving" },
      stage: "preparing",
      step: "proving",
      tokenId: token.id,
    });
    expect(proving).toContain("Preparing to go private");
    expect(proving).toContain('<li data-state="done"><span></span>Check registration');
    expect(proving).toContain('<li data-state="active"><span></span>Build registration proof');
    // Phase and elapsed time from the job's own poll, then the standing hint.
    expect(proving).toContain("Proving (attempt 2 of 3) · 1 min 35 s. Keep the wallet open.");
    expect(proving).toContain("going back discards this preparation");
  });

  test("the working screen carries the submission job's progress on its liveness line", () => {
    const html = privacyFlow(status, preferences, {
      kind: "register",
      preparation: registration,
      progress: { elapsedMs: 4_000, phase: "broadcasting" },
      stage: "working",
      tokenId: token.id,
    });
    expect(html).toContain('id="privacy-liveness"');
    expect(html).toContain("Broadcasting · 4 s. Keep the wallet open.");
  });

  test("a blocked activation explains the prerequisite and ends in its next step", () => {
    const blocked = (kind: PrivacyBlockerKind, message: string): string =>
      privacyFlow(status, preferences, {
        blocker: { kind, message },
        stage: "blocked",
        tokenId: token.id,
      });

    const fund = blocked("fund", "Not enough STRK for the <pool> fee");
    expect(fund).toContain("Go private");
    expect(fund).toContain("Add STRK to go private");
    expect(fund).toContain('data-view="receive"');
    expect(fund).toContain("Fund with STRK");
    // The runtime's own reason is shown, escaped.
    expect(fund).toContain("Not enough STRK for the &lt;pool&gt; fee");
    expect(fund).toContain('id="privacy-cancel"');
    expect(fund).toContain('data-privacy-blocker="fund"');

    const deploy = blocked("deploy", "Deploy this account first");
    expect(deploy).toContain("Deploy this account first");
    // The same deploy-then-register control Receive offers, not a second path.
    expect(deploy).toContain("data-privacy-deploy-register");

    const network = blocked("network", "Private balances are not configured for this network");
    expect(network).toContain("Not available on this network");
    expect(network).toContain('data-view="network"');

    const pending = blocked("pending", "Registration is on its way.");
    expect(pending).toContain("Registration is on its way");
    expect(pending).toContain("no second registration is needed");
    expect(pending).toContain('data-view="activity"');
    expect(pending).not.toContain('id="privacy-retry"');

    const service = blocked("service", "prover offline");
    expect(service).toContain("Private balances unavailable");
    expect(service).toContain('id="privacy-retry"');
    expect(service).toContain("prover offline");

    const ledger = blocked("ledger", "Private balances are not available for Ledger accounts");
    expect(ledger).toContain("Not available for Ledger accounts");
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
