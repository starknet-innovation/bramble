/**
 * Activity keeps account-scoped transaction monitoring separate from parked
 * dApp decisions. This prevents requests from visually bleeding into account
 * history while retaining a clear route to review them.
 */
import { describe, expect, test } from "bun:test";
import type { PendingApproval, WalletStatus } from "../../src/popup/responses";
import { activityScreen, requestsFlow } from "../../src/sidepanel/activity-views";
import type { ActivityEntry } from "../../src/storage/activity-store";
import { account } from "../support/sidepanel-fixtures";

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

const pending: readonly PendingApproval[] = [
  {
    id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
    origin: "https://dapp.example",
  },
];

const transaction: ActivityEntry = {
  accountId: account.id,
  hash: "0x123",
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt: 1,
  summary: "Send 1 STRK",
};

describe("activity journey boundaries", () => {
  test("keeps dApp decision controls out of account transaction history", () => {
    const html = activityScreen(pending, status, [transaction], false);

    expect(html).toContain("Only Starknet Mainnet activity for the active account.");
    expect(html).toContain("Send 1 STRK");
    expect(html).toContain('data-view="requests"');
    expect(html).toContain("1");
    expect(html).not.toContain("https://dapp.example");
    expect(html).not.toContain("data-approval-action");
  });

  test("renders parked requests on their own focused review screen", () => {
    const html = requestsFlow(pending, status);

    expect(html).toContain("These requests were parked for later.");
    expect(html).toContain("https://dapp.example");
    expect(html).toContain('data-approval-action="approve"');
    expect(html).toContain('data-approval-action="deny"');
    expect(html).not.toContain('class="tx-list"');
  });
});
