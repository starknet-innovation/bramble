/**
 * Approval-card rendering per kind: exercises every renderer reached through
 * `approvalCard` — connection (default), sign-typed-data, strk20-invoke,
 * switch-chain, add-chain, declare — plus the watch-asset empty-token guard.
 * Complements sidepanel-approval-card.test.ts, which covers invoke and
 * watch-asset (with token) only.
 */
import { describe, expect, test } from "bun:test";
import type { PendingApproval, WalletStatus } from "../src/popup/responses";
import { approvalCard } from "../src/sidepanel/approval-cards";

const account = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN" as const,
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

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

const lockedStatus: WalletStatus = { ...status, locked: true };

const ID = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
const ORIGIN = "https://dapp.example";

describe("approvalCard renders each approval kind", () => {
  test("connection request (default kind) shows the connect copy and enabled Approve", () => {
    const approval: PendingApproval = { id: ID, kind: "connect", origin: ORIGIN };
    const html = approvalCard(approval, status);

    expect(html).toContain("Connection request");
    expect(html).toContain(ORIGIN);
    expect(html).toContain("this site can see your granted account addresses");
    expect(html).toContain(`data-approval-action="approve" data-approval-id="${ID}"`);
    // Not locked, not blocked: the approve button is enabled.
    expect(html).not.toContain(`data-approval-id="${ID}" type="button" disabled`);
  });

  test("connection request falls through to connect copy when kind is absent", () => {
    const approval: PendingApproval = { id: ID, origin: ORIGIN };
    const html = approvalCard(approval, lockedStatus);

    expect(html).toContain("Connection request");
    expect(html).toContain("Unlock the wallet to approve this site.");
    // Locked: the approve button is disabled.
    expect(html).toContain(`data-approval-id="${ID}" type="button" disabled`);
  });

  test("sign-typed-data request decodes the SNIP-12 payload", () => {
    const approval: PendingApproval = {
      id: ID,
      kind: "sign-typed-data",
      origin: ORIGIN,
      typedData: {
        domain: { chainId: "SN_MAIN", name: "MyDapp", version: "1" },
        message: { contents: "Hello", from: "0xabc" },
        primaryType: "Mail",
        types: {
          Mail: [
            { name: "from", type: "felt" },
            { name: "contents", type: "felt" },
          ],
        },
      },
    };
    const html = approvalCard(approval, status);

    expect(html).toContain("Sign request");
    expect(html).toContain("only sign messages you understand");
    // The decoded domain and message fields are rendered.
    expect(html).toContain("MyDapp");
    expect(html).toContain("Hello");
    expect(html).toContain("Raw typed data");
    expect(html).toContain(`data-approval-action="approve" data-approval-id="${ID}"`);
  });

  test("sign-typed-data request disables Sign while locked", () => {
    const approval: PendingApproval = {
      id: ID,
      kind: "sign-typed-data",
      origin: ORIGIN,
      typedData: { message: {}, primaryType: "Mail" },
    };
    const html = approvalCard(approval, lockedStatus);

    expect(html).toContain("Unlock the wallet to review and sign this message.");
    expect(html).toContain(`data-approval-id="${ID}" type="button" disabled`);
  });

  test("strk20-invoke request shows the private-transaction copy and call summaries", () => {
    const approval: PendingApproval = {
      id: ID,
      kind: "strk20-invoke",
      origin: ORIGIN,
      summaries: ["Withdraw 10 to 0x0471…938d"],
    };
    const html = approvalCard(approval, status);

    expect(html).toContain("Private transaction request");
    expect(html).toContain("Review each private action.");
    expect(html).toContain("Withdraw 10 to 0x0471…938d");
    expect(html).toContain(`data-approval-action="deny" data-approval-id="${ID}"`);
  });

  test("switch-chain request shows the network-switch copy", () => {
    const approval: PendingApproval = {
      id: ID,
      kind: "switch-chain",
      origin: ORIGIN,
      summaries: ["Switch to Starknet Sepolia"],
    };
    const html = approvalCard(approval, status);

    expect(html).toContain("Network switch request");
    expect(html).toContain("asking to change the wallet's active network");
    expect(html).toContain("Switch to Starknet Sepolia");
    expect(html).toContain("Switch network");
  });

  test("add-chain request shows the add-network copy with an always-enabled Approve", () => {
    const approval: PendingApproval = {
      id: ID,
      kind: "add-chain",
      origin: ORIGIN,
      summaries: ["Add network Custom Devnet"],
    };
    // Even a locked wallet leaves add-network enabled (addChainCard passes false).
    const html = approvalCard(approval, lockedStatus);

    expect(html).toContain("Add network request");
    expect(html).toContain("asking to add a custom Starknet network");
    expect(html).toContain("Add network Custom Devnet");
    expect(html).toContain("Add network");
    expect(html).not.toContain(`data-approval-id="${ID}" type="button" disabled`);
  });

  test("declare request shows the declare-contract copy and locks Declare while locked", () => {
    const approval: PendingApproval = {
      id: ID,
      kind: "declare",
      origin: ORIGIN,
      summaries: ["Declare class 0xabc"],
    };
    const html = approvalCard(approval, lockedStatus);

    expect(html).toContain("Declare contract request");
    expect(html).toContain("Unlock the wallet to review and declare this contract class.");
    expect(html).toContain("Declare class 0xabc");
    expect(html).toContain(`data-approval-id="${ID}" type="button" disabled`);
  });

  test("watch-asset request without a token renders nothing", () => {
    const approval: PendingApproval = { id: ID, kind: "watch-asset", origin: ORIGIN };
    expect(approvalCard(approval, status)).toBe("");
  });
});
