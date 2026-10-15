/**
 * The shadow-account approval card (#443, PR 4) renders the lines the
 * background summarizer produces for a `shadow_account_invoke`, escaped, under
 * "What will happen" — the calls, the shadow account and site, the anonymizer,
 * which tokens settle back into private notes, and who can move the remainder.
 */
import { describe, expect, test } from "bun:test";
import { summarizeStrk20Batch } from "@bramble/privacy/service";
import {
  SHADOW_INVOKE_CONTROL,
  SHADOW_INVOKE_SETTLES_NOTHING,
} from "@bramble/privacy/shadow-account-copy";
import {
  PRIVATE_REQUEST_FAILED_NOTICE,
  PRIVATE_SERVICES_UNAVAILABLE_NOTICE,
  SHADOW_ACCOUNT_RECORD_LIMIT_NOTICE,
} from "@bramble/wallet-protocol/privacy-blocker";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { PendingApproval, WalletStatus } from "../../../../src/popup/responses/responses";
import { approvalCard } from "../../../../src/sidepanel/journeys/approvals/approval-cards";

const status = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
} as WalletStatus;

const ANONYMIZER = "0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7";
const ORIGIN = "https://dapp.example";
const actions: readonly Strk20Action[] = [
  {
    calls: [{ calldata: ["0x1"], contract_address: "0x471", entry_point: "swap" }],
    collect_policy: { type: "all" },
    dapp_name: "<b>Example</b>",
    nonce: "0x7",
    type: "shadow_account_invoke",
  },
];

describe("shadow account approval card", () => {
  for (const kind of ["strk20-invoke", "strk20-prepare"] as const) {
    test(`${kind} states what the shadow invoke does`, () => {
      const approval: PendingApproval = {
        actionReviews: [...actions],
        id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
        kind,
        origin: ORIGIN,
        summaries: summarizeStrk20Batch(actions, {
          shadow: { anonymizer: ANONYMIZER, origin: ORIGIN },
        }),
      };
      const html = approvalCard(approval, status);
      expect(html).toContain(`Runs 1 call through your shadow account #7 for ${ORIGIN}`);
      expect(html).toContain(`Shadow account anonymizer ${ANONYMIZER}`);
      expect(html).toContain(SHADOW_INVOKE_SETTLES_NOTHING);
      expect(html).toContain(SHADOW_INVOKE_CONTROL);
      // The site's label is escaped wherever it reaches the card.
      expect(html).not.toContain("<b>Example</b>");
    });
  }

  // A site's private request on a network with no private services is held on
  // a notice (#443): one line and Close. Nothing the site sent reaches it, and
  // there is no approve control — Close answers the site, locked or not.
  for (const locked of [false, true]) {
    test(`the private-services notice shows one line and only Close (locked: ${locked})`, () => {
      const html = approvalCard(
        {
          id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
          kind: "strk20-unavailable",
          origin: ORIGIN,
          summaries: ["<site text>"],
        },
        { ...status, locked },
      );
      expect(html).toContain("Private services aren&#39;t set up for this network.");
      expect(PRIVATE_SERVICES_UNAVAILABLE_NOTICE).toBe(
        "Private services aren't set up for this network.",
      );
      expect(html).toContain('data-approval-action="deny"');
      expect(html).toContain("Close");
      expect(html).not.toContain('data-approval-action="approve"');
      expect(html).not.toContain("site text");
      expect(html).not.toContain("disabled");
    });
  }

  // The same notice holds a request whose shadow-account record cannot be
  // written, or whose review could not be prepared: each gets its own line
  // (approved copy), never the not-set-up line, which would be false.
  for (const [notice, line] of [
    ["record-limit", SHADOW_ACCOUNT_RECORD_LIMIT_NOTICE],
    ["request-failed", PRIVATE_REQUEST_FAILED_NOTICE],
  ] as const) {
    test(`a ${notice} notice shows its own line and only Close`, () => {
      const html = approvalCard(
        {
          id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
          kind: "strk20-unavailable",
          notice,
          origin: ORIGIN,
        },
        status,
      );
      expect(html).toContain(line.replaceAll("'", "&#39;"));
      expect(html).not.toContain("set up for this network");
      expect(html).toContain('data-approval-action="deny"');
      expect(html).not.toContain('data-approval-action="approve"');
    });
  }
});
