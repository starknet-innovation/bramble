/**
 * A gasless choice is another Approve. It stays off a locked card and off a
 * card that can only be denied.
 */
import { describe, expect, test } from "bun:test";
import type { PendingApproval, WalletStatus } from "../../../../src/popup/responses/responses";
import { approvalCard } from "../../../../src/sidepanel/journeys/approvals/approval-cards";

const ACCOUNT_ID = "SN_MAIN:0x01234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";

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

const offer = {
  amount: "1000",
  decimals: 6,
  label: "USDC",
  tokenAddress: "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
};

const invoke = (flags: NonNullable<PendingApproval["flags"]> = []): PendingApproval =>
  ({
    context: {
      accountId: ACCOUNT_ID,
      chainId: "0x534e5f4d41494e",
      networkId: "SN_MAIN",
      payloadDigest: `sha256:${"a".repeat(64)}`,
    },
    fee: { overallFee: "0x1", unit: "FRI" },
    feeAffordability: "insufficient",
    gaslessFees: [offer],
    id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
    kind: "invoke",
    origin: "https://pay.example",
    summaries: ["Send 1 STRK"],
    ...(flags.length > 0 ? { flags } : {}),
  }) as PendingApproval;

describe("gasless controls on an invoke card", () => {
  test("offers the fee token when Approve is available", () => {
    const html = approvalCard(invoke(), status);
    expect(html).toContain("data-gasless-token");
    expect(html).toContain('data-approval-action="approve"');
  });

  test("omits the fee token when the wallet is locked", () => {
    const html = approvalCard(invoke(), { ...status, locked: true });
    expect(html).not.toContain("data-gasless-token");
    expect(html).not.toContain("Pay up to");
  });

  test("omits the fee token when the payment can only be denied", () => {
    const html = approvalCard(
      invoke([
        {
          code: "address-poisoning",
          message:
            "The recipient closely mimics an address you saved or paid but is a different account. Re-check every character before sending.",
        },
      ]),
      status,
    );
    expect(html).not.toContain("data-gasless-token");
    expect(html).not.toContain('data-approval-action="approve"');
    expect(html).toContain('data-approval-action="deny"');
  });
});
