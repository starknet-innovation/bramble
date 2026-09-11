/**
 * Activity keeps account-scoped transaction monitoring separate from parked
 * dApp decisions. This prevents requests from visually bleeding into account
 * history while retaining a clear route to review them.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import { ARGENT_MULTISIG_CONTRACT } from "@bramble/starknet/account-contracts";
import { account } from "@bramble/testkit/sidepanel";
import type { ActivityEntry } from "@bramble/transactions/activity";
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

    expect(html).toContain('<h1 aria-label="Activity on Starknet Mainnet">Activity</h1>');
    expect(html).not.toContain("Only Starknet Mainnet activity");
    expect(html).toContain("Send 1 STRK");
    expect(html).toContain('data-view="requests"');
    expect(html).toContain("1");
    expect(html).not.toContain("https://dapp.example");
    expect(html).not.toContain("data-approval-action");
  });

  test("renders parked requests on their own focused review screen", () => {
    const html = requestsFlow(pending, status);

    expect(html).toContain("Wallet requests");
    expect(html).toContain("https://dapp.example");
    expect(html).toContain('data-approval-action="approve"');
    expect(html).toContain('data-approval-action="deny"');
    expect(html).not.toContain('class="tx-list"');
  });

  test("uses the transaction summary as the sole explorer action", () => {
    const html = activityScreen(pending, status, [transaction], false);

    expect(html).toContain('href="https://starkscan.co/tx/0x123"');
    expect(html).toContain('class="tx-summary-link"');
    expect(html).toContain('aria-label="Send 1 STRK. accepted. View transaction on Starkscan"');
    // A new browsing context, never one that can reach back into the panel.
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain('data-copy="0x123"');
    expect(html).not.toContain("0x123…0x123");
  });

  test("names the UTC time and status beneath every summary, once for assistive tech", () => {
    const html = activityScreen(
      [],
      status,
      [
        { ...transaction, submittedAt: 1752501900000 },
        { ...transaction, hash: "0x124", status: "preconfirmed", submittedAt: 1752501960000 },
      ],
      false,
    );

    expect(html).toContain('<span class="tx-meta" aria-hidden="true">14:05 UTC · Accepted</span>');
    expect(html).toContain(
      '<span class="tx-meta" aria-hidden="true">14:06 UTC · Pre-confirmed</span>',
    );
    // The status still reaches assistive tech through the summary's own label.
    expect(html).toContain('aria-label="Send 1 STRK. accepted. View transaction on Starkscan"');
  });

  test("groups the newest-first feed under one heading per UTC day", () => {
    const html = activityScreen(
      [],
      status,
      [
        { ...transaction, submittedAt: 1752501960000 },
        { ...transaction, hash: "0x124", submittedAt: 1752501900000 },
        { ...transaction, hash: "0x125", submittedAt: 1752415500000 },
        { ...transaction, hash: "0x126", submittedAt: 0 },
      ],
      false,
    );

    const headings = [...html.matchAll(/<h3 class="tx-day-label eyebrow">([^<]+)<\/h3>/g)].map(
      (match) => match[1],
    );
    expect(headings).toEqual(["14 Jul 2025", "13 Jul 2025", "Undated"]);
    // Same-day entries share one list; each day is its own list.
    expect(html.match(/<ul class="tx-list">/g)?.length).toBe(3);
    expect(html.indexOf('data-live-key="transaction:0x123:status"')).toBeLessThan(
      html.indexOf('data-live-key="transaction:0x124:status"'),
    );
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

    expect(html).toContain(
      'class="tx-kind-icon tx-kind-transfer accepted" aria-label="Transfer, accepted"',
    );
    expect(html).toContain(
      'class="tx-kind-icon tx-kind-swap accepted" aria-label="Swap, accepted"',
    );
    expect(html).toContain(
      'class="tx-kind-icon tx-kind-stake accepted" aria-label="Stake, accepted"',
    );
    expect(html).toContain(
      'class="tx-kind-icon tx-kind-unstake accepted" aria-label="Unstake, accepted"',
    );
    expect(html).toContain(
      'class="tx-kind-icon tx-kind-reward accepted" aria-label="Claim rewards, accepted"',
    );
    expect(html).toContain(
      'class="tx-kind-icon tx-kind-private accepted" aria-label="Private transaction, accepted"',
    );
  });

  test("omits the explorer link on a network that has none", () => {
    const devnet: WalletStatus = { ...status, networkId: "SN_DEVNET" };
    const html = activityScreen([], devnet, [{ ...transaction, networkId: "SN_DEVNET" }], false);

    expect(html).not.toContain("data-tx-explorer");
    expect(html).not.toContain("starkscan.co");
    expect(html).not.toContain('data-copy="0x123"');
    expect(html).toContain('<span class="sr-only">. accepted.</span>');
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
    expect(html).toContain('<h1 aria-label="Activity on Starknet Mainnet">Activity</h1>');
    expect(html).not.toContain("activity for Treasury");
  });
});
