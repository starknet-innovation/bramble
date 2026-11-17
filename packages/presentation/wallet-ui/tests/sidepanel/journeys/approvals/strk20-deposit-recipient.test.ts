/**
 * Audit finding 139, side-panel half. A STRK20 `deposit` carrying a recipient
 * credits that account's private balance. The approval card must show the
 * Recipient row in its exact parameters and, when the recipient is not the
 * account the approval is bound to, warn that the amount becomes another
 * account's private note — on both dapp routes that queue actions
 * (`strk20-invoke` and `strk20-prepare`). A self-deposit stays warning-free.
 */
import { describe, expect, test } from "bun:test";
import type { PendingApproval, WalletStatus } from "../../../../src/popup/responses/responses";
import { approvalCard } from "../../../../src/sidepanel/journeys/approvals/approval-cards";

const ACCOUNT = "0x01234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
const ACCOUNT_ID = `SN_MAIN:${ACCOUNT}`;
const PAYEE = "0xa77ac4e2a77ac4e2a77ac4e2a77ac4e2a77ac4e2a77ac4e2a77ac4e2a77ac4";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const WARNING = "becomes that account&#39;s private note";

const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: ACCOUNT_ID,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const card = (
  kind: "strk20-invoke" | "strk20-prepare",
  recipient: string | undefined,
  options: { readonly context?: boolean; readonly summary?: string } = {},
): string =>
  approvalCard(
    {
      actionReviews: [
        {
          amount: "0x5",
          ...(recipient === undefined ? {} : { recipient }),
          token: TOKEN,
          type: "deposit",
        },
      ],
      ...(options.context === false
        ? {}
        : {
            context: {
              accountId: ACCOUNT_ID,
              chainId: "0x534e5f4d41494e",
              networkId: "SN_MAIN",
              payloadDigest: `sha256:${"a".repeat(64)}`,
            },
          }),
      id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
      kind,
      origin: "https://shield.example",
      summaries: [options.summary ?? "Deposit 0x5 to private balance (0x049d36…4dc7)"],
    } satisfies PendingApproval,
    status,
  );

describe("STRK20 deposit recipient on approval cards", () => {
  for (const kind of ["strk20-invoke", "strk20-prepare"] as const) {
    test(`${kind} shows the Recipient row and warns for a deposit paying another account`, () => {
      const html = card(kind, PAYEE);

      expect(html).toContain("<dt>Recipient</dt>");
      expect(html).toContain(`<code>${PAYEE}</code>`);
      expect(html).toContain("Copy action 1 recipient address");
      expect(html).toContain("Risk and recovery");
      expect(html).toContain(`This deposit pays 0xa77a…7ac4: the amount becomes`);
      expect(html).toContain(WARNING);
    });

    test(`${kind} keeps a deposit to the bound account free of the payee warning`, () => {
      const unpadded = `0x${ACCOUNT.slice(3)}`;
      for (const html of [card(kind, ACCOUNT), card(kind, unpadded)]) {
        expect(html).toContain("<dt>Recipient</dt>");
        expect(html).not.toContain(WARNING);
      }
    });

    test(`${kind} renders a recipient-free deposit as a plain shield`, () => {
      const html = card(kind, undefined);

      expect(html).not.toContain("<dt>Recipient</dt>");
      expect(html).not.toContain(WARNING);
      expect(html).not.toContain("Risk and recovery");
    });

    test(`${kind} warns when no bound account proves the recipient is this one`, () => {
      expect(card(kind, ACCOUNT, { context: false })).toContain(WARNING);
    });

    test(`${kind} escapes a hostile recipient and summary`, () => {
      const hostile = `<img src=x onerror="alert(1)">`;
      const html = card(kind, hostile, { summary: `Pay 0x5 privately to ${hostile}` });

      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
      expect(html).toContain(WARNING);
    });
  }
});
