/**
 * Activity keeps account-scoped transaction monitoring separate from parked
 * dApp decisions. This prevents requests from visually bleeding into account
 * history while retaining a clear route to review them.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { TokenConfig } from "@bramble/settings/preferences";
import { ARGENT_MULTISIG_CONTRACT } from "@bramble/starknet/account-contracts";
import { account } from "@bramble/testkit/sidepanel";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { PendingApproval, WalletStatus } from "../../../../src/popup/responses/responses";
import type { ActivityPricing } from "../../../../src/sidepanel/journeys/portfolio/activity-format";
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

const strk: TokenConfig = {
  address: STRK_TOKEN_ADDRESS,
  decimals: 18,
  id: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};

const pricing: ActivityPricing = {
  currency: "usd",
  prices: { [STRK_TOKEN_ADDRESS]: 0.5 },
  tokens: [strk],
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
    // The visible text is the verb; the accessible name keeps the whole record
    // (prefixed by the verb, since "Send 1 STRK" does not start with "Sent").
    expect(html).toContain(
      'aria-label="Sent. Send 1 STRK. accepted. View transaction on Starkscan">Sent</a>',
    );
    // A new browsing context, never one that can reach back into the panel.
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain('data-copy="0x123"');
    expect(html).not.toContain("0x123…0x123");
  });

  test("names the status and UTC time beneath every summary, once for assistive tech", () => {
    const html = activityScreen(
      [],
      status,
      [
        { ...transaction, submittedAt: 1752501900000 },
        { ...transaction, hash: "0x124", status: "preconfirmed", submittedAt: 1752501960000 },
      ],
      false,
    );

    // Status first: the line ellipsises from the right, so the state survives.
    expect(html).toContain('<span class="tx-meta" aria-hidden="true">Accepted · 14:05 UTC</span>');
    expect(html).toContain(
      '<span class="tx-meta" aria-hidden="true">Pre-confirmed · 14:06 UTC</span>',
    );
    // The status still reaches assistive tech through the summary's own label.
    expect(html).toContain(
      'aria-label="Sent. Send 1 STRK. accepted. View transaction on Starkscan"',
    );
    expect(html).toContain(
      'aria-label="Sent. Send 1 STRK. pre-confirmed. View transaction on Starkscan"',
    );
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

    const headings = [...html.matchAll(/<h3 class="tx-day-label">([^<]+)<\/h3>/g)].map(
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
    // Each kind carries the design kit's outline glyph (Lucide paths, verbatim).
    const glyph = (type: string): string =>
      html.match(new RegExp(`tx-kind-${type} accepted"[^>]*><svg[^>]*>(.*?)</svg>`))?.[1] ?? "";
    expect(glyph("transfer")).toContain('<path d="m7 7 10 10" />'); // arrow-down-right
    expect(glyph("swap")).toContain('<path d="M4 7h16" />'); // arrow-left-right
    expect(glyph("stake")).toContain('<path d="M7 10V7a5 5 0 0 1 10 0v3" />'); // lock-keyhole
    expect(glyph("unstake")).toContain('<path d="M7 10V7a5 5 0 0 1 9.33-2.5" />'); // lock-keyhole-open
    expect(glyph("reward")).toContain('<rect width="20" height="14" x="2" y="5" rx="2" />'); // credit-card
    expect(glyph("private")).toContain('<path d="M20 13c0 5-3.5 7.5-7.66 8.95'); // shield
    const received = activityScreen(
      [],
      status,
      [{ ...transaction, summary: "Received 1 STRK" }],
      false,
    );
    expect(received).toContain('<path d="M4 4h7a4 4 0 0 1 4 4v12" />'); // corner-right-down
  });

  test("omits the explorer link on a network that has none", () => {
    const devnet: WalletStatus = { ...status, networkId: "SN_DEVNET" };
    const html = activityScreen([], devnet, [{ ...transaction, networkId: "SN_DEVNET" }], false);

    expect(html).not.toContain("data-tx-explorer");
    expect(html).not.toContain("starkscan.co");
    expect(html).not.toContain('data-copy="0x123"');
    // No link, so the verb is plain text and the record plus status follow it
    // for assistive tech only.
    expect(html).toContain(
      '<strong class="tx-summary">Sent<span class="sr-only">. Send 1 STRK. accepted.</span></strong>',
    );
  });

  test("lays each row out as verb, detail, signed fiat delta, asset amount, and token mark", () => {
    const html = activityScreen(
      [],
      status,
      [
        {
          ...transaction,
          amount: "12.345678",
          counterparty: "0x0123456789abcdef0123456789abcdef",
          summary: "Send 12.345678 STRK to 0x0123…cdef",
          token: "STRK",
        },
        {
          ...transaction,
          amount: "3",
          counterparty: "0x0123456789abcdef0123456789abcdef",
          hash: "0x124",
          summary: "Received 3 STRK from 0x0123…cdef",
          token: "STRK",
        },
      ],
      false,
      null,
      pricing,
    );

    // Sent: verb, "To <short address>", a negative delta over the amount.
    expect(html).toContain(
      'aria-label="Sent. Send 12.3456 STRK to 0x0123…cdef. accepted. View transaction on Starkscan">Sent</a>',
    );
    expect(html).toContain('<span class="tx-detail">To 0x0123…cdef</span>');
    expect(html).toContain('<span class="tx-fiat">−$6.17</span>');
    expect(html).toContain('<span class="tx-amount">12.3456 STRK</span>');
    // Received: the summary already starts with the verb, so the name is the record.
    expect(html).toContain(
      'aria-label="Received 3 STRK from 0x0123…cdef. accepted. View transaction on Starkscan">Received</a>',
    );
    expect(html).toContain('<span class="tx-detail">From 0x0123…cdef</span>');
    expect(html).toContain('<span class="tx-fiat">+$1.50</span>');
    expect(html).toContain('<span class="tx-amount">3 STRK</span>');
    // The trailing mark is the bundled STRK logo, resolved from the tracked token.
    expect(html.match(/<span class="tx-avatar"><svg class="token-logo"/g)?.length).toBe(2);
    // Structure: leading copy, trailing figures, then the mark.
    expect(html).toMatch(
      /<li class="tx-row" data-live-group>\s*<div class="tx-copy">[\s\S]*?<\/div>\s*<div class="tx-side">[\s\S]*?<\/div>\s*<span class="tx-avatar">/,
    );
  });

  test("never shows a fiat figure for an entry whose token or price is unknown", () => {
    const unknownToken = { ...transaction, amount: "2", summary: "Send 2 XYZ", token: "XYZ" };
    const priced = {
      ...transaction,
      amount: "2",
      hash: "0x124",
      summary: "Send 2 STRK",
      token: "STRK",
    };
    const approval = {
      ...transaction,
      amount: "5",
      hash: "0x125",
      kind: "invoke" as const,
      summary: "Allow 0x0123…cdef to spend 5 STRK",
      token: "STRK",
    };

    // Untracked symbol: the asset amount stands alone; the mark is a letter badge.
    const noToken = activityScreen([], status, [unknownToken], false, null, pricing);
    expect(noToken).toContain('<span class="tx-fiat is-unknown">—</span>');
    expect(noToken).toContain('<span class="tx-amount">2 XYZ</span>');
    expect(noToken).toContain('<span class="tx-avatar"><span class="token-mark"');

    // Tracked symbol without a cached price.
    const noPrice = activityScreen([], status, [priced], false, null, { ...pricing, prices: {} });
    expect(noPrice).toContain('<span class="tx-fiat is-unknown">—</span>');
    expect(noPrice).toContain('<span class="tx-amount">2 STRK</span>');

    // A symbol two tracked tokens share is ambiguous, so it prices nothing.
    const ambiguous = activityScreen([], status, [priced], false, null, {
      ...pricing,
      tokens: [strk, { ...strk, address: "0x777", id: "SN_MAIN:STRK:0x777" }],
    });
    expect(ambiguous).toContain('<span class="tx-fiat is-unknown">—</span>');

    // No prices threaded at all (design-system specimen, older callers).
    const unpriced = activityScreen([], status, [priced], false);
    expect(unpriced).toContain('<span class="tx-fiat is-unknown">—</span>');
    expect(unpriced).toContain('<span class="tx-amount">2 STRK</span>');

    // An approval moves no value: amount shown, never a signed delta.
    const allowance = activityScreen([], status, [approval], false, null, pricing);
    expect(allowance).toContain('aria-label="Approval, accepted"');
    expect(allowance).toContain('<span class="tx-fiat is-unknown">—</span>');
    expect(allowance).toContain('<span class="tx-amount">5 STRK</span>');
    expect(allowance).toContain('<span class="tx-detail">0x0123…cdef to spend 5 STRK</span>');
  });

  test("derives the verb and detail line from the record without repeating either", () => {
    const html = activityScreen(
      [],
      status,
      [
        {
          ...transaction,
          amount: "1",
          hash: "0x124",
          kind: "invoke",
          summary: "Swap 1 STRK for ~2.5 USDC via AVNU",
          token: "STRK",
        },
        { ...transaction, hash: "0x125", kind: "invoke", summary: "Unstake 10 STRK" },
        { ...transaction, hash: "0x126", kind: "invoke", summary: "Claim rewards" },
        { ...transaction, hash: "0x127", kind: "invoke", summary: "Supplied 200 USDC to Vesu" },
        { ...transaction, hash: "0x128", kind: "deploy", summary: "Deploy account contract" },
        {
          ...transaction,
          amount: "5",
          hash: "0x129",
          kind: "invoke",
          summary: "Send 5 USDC privately",
          token: "USDC",
        },
      ],
      false,
      null,
      pricing,
    );

    expect(html).toContain(">Swapped</a>");
    expect(html).toContain('<span class="tx-detail">STRK to USDC</span>');
    expect(html).toContain(">Unstaked</a>");
    expect(html).toContain('<span class="tx-detail">10 STRK</span>');
    expect(html).toContain(">Claimed rewards</a>");
    expect(html).toContain(">Interacted</a>");
    expect(html).toContain('<span class="tx-detail">Supplied 200 USDC to Vesu</span>');
    expect(html).toContain(">Deployed</a>");
    expect(html).toContain('<span class="tx-detail">Account contract</span>');
    expect(html).toContain(">Private transfer</a>");
    expect(html).toContain('<span class="tx-amount">5 USDC</span>');
    // A record that says nothing beyond its verb has no detail line at all.
    expect(html).not.toContain('<span class="tx-detail"></span>');
    expect(html.match(/<span class="tx-detail">/g)?.length).toBe(4);
    // The tracked STRK swap and the four token-less rows (network mark) carry a
    // bundled logo; the untracked USDC row gets a letter badge.
    expect(html.match(/<span class="tx-avatar"><svg class="token-logo"/g)?.length).toBe(5);
    expect(html.match(/<span class="tx-avatar"><span class="token-mark"/g)?.length).toBe(1);
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
