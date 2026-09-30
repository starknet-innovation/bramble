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
import { utcDayKey } from "../../../../src/sidepanel/shared/timestamp";

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
    expect(html).toContain("Sent 1 STRK");
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

  test("puts the explorer link on the visible transaction hash", () => {
    const html = activityScreen(pending, status, [transaction], false);

    // The heading used to be the link, which gave a reader no sign that the
    // row led anywhere. The hash is printed now and carries the link itself.
    expect(html).toContain('href="https://starkscan.co/tx/0x123"');
    expect(html).toContain('class="tx-hash"');
    expect(html).toContain('aria-label="View this transaction on Starkscan"');
    expect(html).not.toContain("tx-summary-link");
    // A new browsing context, never one that can reach back into the panel.
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  });

  test("opens the row in place for the rest of the record", () => {
    const html = activityScreen(pending, status, [transaction], false);

    // Open state survives the shell repaint through the shared disclosure
    // bookkeeping, so a refresh cannot snap an expanded row shut.
    expect(html).toContain('<details class="disclosure tx-disclosure" data-disclosure="tx:0x123">');
    expect(html).toContain("<dt>Submitted</dt>");
    expect(html).toContain("1 Jan 1970");
  });

  test("says nothing beneath a settled row and only the status word beneath a provisional one", () => {
    const html = activityScreen(
      [],
      status,
      [
        { ...transaction, submittedAt: 1752501900000 },
        { ...transaction, hash: "0x124", status: "preconfirmed", submittedAt: 1752501960000 },
        { ...transaction, hash: "0x125", status: "pending", submittedAt: 1752502020000 },
      ],
      false,
    );

    // A settled row is verb and detail alone; its status and time live on the
    // row's tooltip, so the feed reads like the kit without losing the record.
    expect(html.match(/<span class="tx-meta/g)?.length).toBe(2);
    expect(html).toContain('<li class="tx-row" data-live-group title="Accepted · 14:05 UTC">');
    expect(html).toContain('<span class="tx-meta preconfirmed">Pre-confirmed</span>');
    expect(html).toContain('<li class="tx-row" data-live-group title="Pre-confirmed · 14:06 UTC">');
    expect(html).toContain('<span class="tx-meta pending">Pending</span>');
    // The status and time still reach assistive tech through the summary's own label.
    expect(html).toContain('aria-label="Sent 1 STRK. accepted, 14:05 UTC"');
    expect(html).toContain('aria-label="Sent 1 STRK. pre-confirmed, 14:06 UTC"');
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

  test("names the current and previous UTC day in words when the clock is known", () => {
    const entries = [
      { ...transaction, submittedAt: 1752501960000 },
      { ...transaction, hash: "0x125", submittedAt: 1752415500000 },
      { ...transaction, hash: "0x126", submittedAt: 1752329100000 },
    ];
    const labels = (html: string): string[] =>
      [...html.matchAll(/<h3 class="tx-day-label">([^<]+)<\/h3>/g)].map((match) => match[1] ?? "");

    const today = utcDayKey(1752501960000);
    expect(labels(activityScreen([], status, entries, false, null, undefined, today))).toEqual([
      "Today",
      "Yesterday",
      "12 Jul 2025",
    ]);
    // The clock moved on: the same feed is a day older, and only the day
    // boundary matters, never the time of day.
    expect(labels(activityScreen([], status, entries, false, null, undefined, today + 1))).toEqual([
      "Yesterday",
      "13 Jul 2025",
      "12 Jul 2025",
    ]);
    // Without a clock (older callers, the design-system specimen) every day is dated.
    expect(labels(activityScreen([], status, entries, false))).toEqual([
      "14 Jul 2025",
      "13 Jul 2025",
      "12 Jul 2025",
    ]);
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

    expect(html).toContain('class="tx-kind-icon tx-kind-transfer accepted" aria-hidden="true"');
    expect(html).toContain('class="tx-kind-icon tx-kind-swap accepted" aria-hidden="true"');
    expect(html).toContain('class="tx-kind-icon tx-kind-stake accepted" aria-hidden="true"');
    expect(html).toContain('class="tx-kind-icon tx-kind-unstake accepted" aria-hidden="true"');
    expect(html).toContain('class="tx-kind-icon tx-kind-reward accepted" aria-hidden="true"');
    expect(html).toContain('class="tx-kind-icon tx-kind-private accepted" aria-hidden="true"');
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
    expect(received).toContain('<path d="M17 17H7V7" />'); // arrow-down-left
  });

  test("omits the explorer link on a network that has none", () => {
    const devnet: WalletStatus = { ...status, networkId: "SN_DEVNET" };
    const html = activityScreen([], devnet, [{ ...transaction, networkId: "SN_DEVNET" }], false);

    expect(html).not.toContain("data-tx-explorer");
    expect(html).not.toContain("starkscan.co");
    expect(html).not.toContain('data-copy="0x123"');
    // No explorer, so the hash is printed as plain text rather than a link
    // that could not resolve.
    expect(html).toContain('<code class="tx-hash is-plain">');
    expect(html).not.toContain('class="tx-hash" href');
  });

  test("leads with the verb and its amount, and files the rest under the row", () => {
    const party = "0x0123456789abcdef0123456789abcdef";
    const html = activityScreen(
      [],
      status,
      [
        {
          ...transaction,
          amount: "12.345678",
          counterparty: party,
          summary: "Send 12.345678 STRK to 0x0123…cdef",
          token: "STRK",
        },
        {
          ...transaction,
          amount: "3",
          counterparty: party,
          hash: "0x124",
          summary: "Received 3 STRK from 0x0123…cdef",
          token: "STRK",
        },
      ],
      false,
      null,
      pricing,
    );

    // The figure reads on the collapsed line beside the verb, where the asset
    // column used to carry it alone.
    expect(html).toContain('<strong class="tx-title">Sent 12.3456 STRK</strong>');
    expect(html).toContain('<strong class="tx-title">Received 3 STRK</strong>');
    // The counterparty moved into the expansion, still truncated on the line
    // with the full value on its copy control.
    expect(html).toContain(`<dt>Recipient</dt>`);
    expect(html).toContain(`<dt>Sender</dt>`);
    expect(html).toContain(`data-copy="${party}"`);
    expect(html).not.toContain(`>To ${party}<`);
    // No fiat anywhere: a figure from today's price is not what these were
    // worth when they were sent.
    expect(html).not.toContain("tx-fiat");
    expect(html).not.toContain("tx-side");
    expect(html).not.toContain("$6.17");
    // The trailing mark is the bundled STRK logo, resolved from the tracked
    // token, and nothing else: every row is on Starknet, so no network badge.
    expect(html.match(/<span class="tx-avatar"><svg class="token-logo"/g)?.length).toBe(2);
    expect(html).not.toContain("tx-avatar-badge");
  });

  test("shows no fiat figure at all, priced or not", () => {
    const unknownToken = { ...transaction, amount: "2", summary: "Send 2 XYZ", token: "XYZ" };
    const priced = { ...transaction, amount: "2", hash: "0x124", token: "STRK" };

    // Whatever the pricing state, the row states the asset amount and makes no
    // claim about what it was worth — the wallet only knows today's price.
    for (const html of [
      activityScreen([], status, [unknownToken], false, null, pricing),
      activityScreen([], status, [priced], false, null, { ...pricing, prices: {} }),
      activityScreen([], status, [priced], false),
    ]) {
      expect(html).not.toContain("tx-fiat");
      expect(html).not.toContain("$");
    }

    // The amount still reads, on the heading, and an untracked symbol still
    // gets its letter badge.
    const noToken = activityScreen([], status, [unknownToken], false, null, pricing);
    expect(noToken).toContain('<strong class="tx-title">Sent 2 XYZ</strong>');
    expect(noToken).toContain('<span class="tx-avatar"><span class="token-mark"');
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
          summary: "Swap 1 STRK for ~2.5 USDC via avnu",
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

    expect(html).toContain('<strong class="tx-title">Swapped 1 STRK</strong>');

    expect(html).toContain('<strong class="tx-title">Unstaked 10 STRK</strong>');

    expect(html).toContain('<strong class="tx-title">Claimed rewards</strong>');
    expect(html).toContain("Supplied 200 USDC to Vesu");

    expect(html).toContain('<strong class="tx-title">Deployed Account contract</strong>');

    expect(html).toContain('<strong class="tx-title">Private transfer 5 USDC</strong>');

    // Nothing repeats: a verb that already carries its figure gets no Detail
    // row in the panel below it.
    expect(html).not.toContain("<dd></dd>");
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
