/**
 * Approval-takeover view checks: a pending dapp request proactively takes over
 * dock views with its decision controls, and snoozed requests release the
 * takeover while staying visible in Activity. Split from sidepanel-views so
 * both files stay within the size budget.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { dashboard } from "../../src/sidepanel/views";
import { account, preferences, secondAccount } from "../support/sidepanel-fixtures";

const status: WalletStatus = {
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_SEPOLIA", name: "Starknet Sepolia" },
  ],
  ready: true,
};

describe("approval takeover views", () => {
  test("a pending request takes over dock views with its decision controls", () => {
    // Proactive surfacing: the request IS the screen on every dock view — the
    // user never has to go find it. The full card renders with approve/deny
    // plus the "Not now" snooze, and the dock is hidden so the decision is the
    // one task in front of the user.
    const pending = [
      { id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14", origin: "https://dapp.example" },
    ];
    const home = dashboard("home", status, pending, preferences, { balances: [] });
    const quiet = dashboard("home", status, [], preferences, { balances: [] });

    expect(home).toContain("Review request");
    expect(home).toContain("https://dapp.example");
    expect(home).toContain('data-approval-action="approve"');
    expect(home).toContain('data-approval-action="deny"');
    expect(home).toContain(`data-approval-later="${pending[0]?.id}"`);
    expect(home).not.toContain("wallet-dock");
    expect(quiet).not.toContain("Review request");
    expect(quiet).toContain("wallet-dock");
  });

  test("snoozed requests release the takeover and stay in Activity", () => {
    const pending = [
      { id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14", origin: "https://dapp.example" },
      { id: "c92d6ee2-64aa-4c8c-b282-1a1b19f1aa25", origin: "https://other.example" },
    ];
    const snoozedFirst = dashboard(
      "home",
      status,
      pending,
      preferences,
      { balances: [] },
      null,
      [],
      [],
      {},
      [],
      null,
      [],
      null,
      {},
      [],
      [],
      null,
      null,
      null,
      null,
      false,
      null,
      [],
      null,
      null,
      false,
      [pending[0]?.id ?? ""],
    );
    // The next unsnoozed request takes the screen.
    expect(snoozedFirst).toContain("Review request");
    expect(snoozedFirst).toContain("https://other.example");
    const allSnoozed = dashboard(
      "home",
      status,
      pending,
      preferences,
      { balances: [] },
      null,
      [],
      [],
      {},
      [],
      null,
      [],
      null,
      {},
      [],
      [],
      null,
      null,
      null,
      null,
      false,
      null,
      [],
      null,
      null,
      false,
      pending.map((approval) => approval.id),
    );
    // Fully snoozed: home returns with the waiting-requests callout and badge.
    expect(allSnoozed).not.toContain("Review request");
    expect(allSnoozed).toContain('class="badge"');
    expect(allSnoozed).toContain("requests waiting");
  });
});
