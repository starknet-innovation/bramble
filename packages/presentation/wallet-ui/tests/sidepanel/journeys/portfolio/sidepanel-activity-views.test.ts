/**
 * Activity keeps account-scoped transaction monitoring separate from parked
 * dApp decisions. This prevents requests from visually bleeding into account
 * history while retaining a clear route to review them.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigRecord } from "@mc-wallet/multisig/repository";
import { ARGENT_MULTISIG_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import { account } from "@mc-wallet/testkit/sidepanel";
import type { ActivityEntry } from "@mc-wallet/transactions/activity";
import type { PendingApproval, WalletStatus } from "../../../../src/popup/responses/responses";
import {
  activityScreen,
  requestsFlow,
} from "../../../../src/sidepanel/journeys/portfolio/activity-views";

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
    kind: "connect",
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

const multisig: ArgentMultisigRecord = {
  accountContractType: "argent-multisig",
  address: "0x999",
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  id: "SN_MAIN:0x999",
  name: "Treasury",
  networkId: "SN_MAIN",
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

  test("offers an outbound explorer link beside the copy control", () => {
    const html = activityScreen(pending, status, [transaction], false);

    expect(html).toContain('href="https://starkscan.co/tx/0x123"');
    expect(html).toContain('data-tx-explorer="0x123"');
    expect(html).toContain("View transaction on Starkscan");
    // A new browsing context, never one that can reach back into the panel.
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    // The copy control stays: the link is additive.
    expect(html).toContain('data-copy="0x123"');
  });

  test("uses distinct accessible glyphs for common transaction outcomes", () => {
    const html = activityScreen(
      [],
      status,
      [
        transaction,
        { ...transaction, hash: "0x124", kind: "invoke", summary: "Swap 1 STRK for USDC" },
        { ...transaction, hash: "0x125", kind: "invoke", summary: "Stake 10 STRK" },
        { ...transaction, hash: "0x126", kind: "invoke", summary: "Unstake 10 STRK" },
        { ...transaction, hash: "0x127", kind: "invoke", summary: "Claim rewards" },
        { ...transaction, hash: "0x128", kind: "invoke", summary: "Private transfer 5 USDC" },
      ],
      false,
    );

    expect(html).toContain('class="tx-kind-icon tx-kind-transfer" aria-label="Transfer"');
    expect(html).toContain('class="tx-kind-icon tx-kind-swap" aria-label="Swap"');
    expect(html).toContain('class="tx-kind-icon tx-kind-stake" aria-label="Stake"');
    expect(html).toContain('class="tx-kind-icon tx-kind-unstake" aria-label="Unstake"');
    expect(html).toContain('class="tx-kind-icon tx-kind-reward" aria-label="Claim rewards"');
    expect(html).toContain('class="tx-kind-icon tx-kind-private" aria-label="Private transaction"');
  });

  test("omits the explorer link on a network that has none", () => {
    const devnet: WalletStatus = { ...status, networkId: "SN_DEVNET" };
    const html = activityScreen([], devnet, [{ ...transaction, networkId: "SN_DEVNET" }], false);

    expect(html).not.toContain("data-tx-explorer");
    expect(html).not.toContain("starkscan.co");
    expect(html).toContain('data-copy="0x123"');
  });

  test("labels and exposes the selected shared-account activity scope", () => {
    const html = activityScreen(
      [],
      status,
      [{ ...transaction, accountId: multisig.id }],
      false,
      multisig,
    );

    expect(html).toContain(`data-activity-account-id="${multisig.id}"`);
    expect(html).toContain("Only Starknet Mainnet activity for Treasury.");
    expect(html).not.toContain("for the active account");
  });
});
