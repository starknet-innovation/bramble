/**
 * Sherlock 140, side-panel half. A site's payment to a lookalike of an address
 * the user saved or paid is queued with an `address-poisoning` flag instead of
 * refused on arrival, so the answer cannot reveal the address book. The card
 * must show the warning and offer Deny only, on every payment route a site can
 * open: public invoke, private invoke and private preparation.
 */
import { describe, expect, test } from "bun:test";
import type { PendingApproval, WalletStatus } from "../../../../src/popup/responses/responses";
import { approvalCard } from "../../../../src/sidepanel/journeys/approvals/approval-cards";

const ACCOUNT_ID = "SN_MAIN:0x01234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const POISONED = {
  code: "address-poisoning",
  message:
    "The recipient closely mimics an address you saved or paid but is a different account. Re-check every character before sending.",
};

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

const base = {
  context: {
    accountId: ACCOUNT_ID,
    chainId: "0x534e5f4d41494e",
    networkId: "SN_MAIN",
    payloadDigest: `sha256:${"a".repeat(64)}`,
  },
  id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
  origin: "https://pay.example",
  summaries: ["Send 0x1"],
} as const;

const approvals = (flags: NonNullable<PendingApproval["flags"]>): readonly PendingApproval[] => [
  {
    ...base,
    fee: { overallFee: "0x1", unit: "FRI" },
    feeAffordability: "ok",
    flags,
    kind: "invoke",
  },
  {
    ...base,
    actionReviews: [{ amount: "0x1", recipient: "0xbeef", token: TOKEN, type: "transfer" }],
    flags,
    kind: "strk20-invoke",
  },
  {
    ...base,
    actionReviews: [{ amount: "0x1", recipient: "0xbeef", token: TOKEN, type: "transfer" }],
    flags,
    kind: "strk20-prepare",
  },
];

describe("a payment to a lookalike recipient", () => {
  test("shows the warning and offers Deny only, on every payment card", () => {
    for (const approval of approvals([POISONED])) {
      const html = approvalCard(approval, status);
      expect(html).toContain("closely mimics an address you saved or paid");
      expect(html).toContain('data-approval-action="deny"');
      expect(html).not.toContain('data-approval-action="approve"');
    }
  });

  test("leaves Approve on the same cards without the flag", () => {
    for (const approval of approvals([])) {
      expect(approvalCard(approval, status)).toContain('data-approval-action="approve"');
    }
  });
});
