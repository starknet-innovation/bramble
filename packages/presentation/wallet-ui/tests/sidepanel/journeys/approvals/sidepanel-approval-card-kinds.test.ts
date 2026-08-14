/**
 * Approval-card rendering per kind: exercises every renderer reached through
 * `approvalCard` — connection, sign-typed-data, strk20-invoke,
 * switch-chain, add-chain, declare — plus the watch-asset empty-token guard.
 * Complements sidepanel-approval-card.test.ts, which covers invoke and
 * watch-asset (with token) only.
 */
import { describe, expect, test } from "bun:test";
import type { PendingApproval, WalletStatus } from "../../../../src/popup/responses/responses";
import { approvalCard } from "../../../../src/sidepanel/journeys/approvals/approval-cards";

const account = {
  accountContractType: "openzeppelin" as const,
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
  test("connection request shows the connect copy and enabled Approve", () => {
    const approval: PendingApproval = { id: ID, kind: "connect", origin: ORIGIN };
    const html = approvalCard(approval, status);

    expect(html).toContain("Connection request");
    expect(html).toContain(ORIGIN);
    expect(html).toContain("this site can see your granted account addresses");
    expect(html).toContain(`data-approval-action="approve" data-approval-id="${ID}"`);
    // Not locked, not blocked: the approve button is enabled.
    expect(html).not.toContain(`data-approval-id="${ID}" type="button" disabled`);
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
          // The revision 0 domain struct: without it the payload identifies no
          // revision, nothing in it reaches a hash, and the card is required to
          // withhold the approve control rather than describe it as signed.
          StarkNetDomain: [
            { name: "name", type: "felt" },
            { name: "version", type: "felt" },
            { name: "chainId", type: "felt" },
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
      actionReviews: [
        { amount: "0x5", token: "0x49d", type: "deposit" },
        {
          calls: [
            {
              calldata: ["0x1", "0x2"],
              contract_address: "0x471",
              entry_point: "transfer",
            },
          ],
          collect_policy: { amount: "0xa", type: "exact" },
          dapp_name: "Example",
          nonce: "0x7",
          type: "subaccount_invoke",
        },
      ],
      id: ID,
      kind: "strk20-invoke",
      origin: ORIGIN,
      relayFeeAction: {
        amount: "0x1",
        recipient: "0x99",
        token: "0x49d",
        type: "withdraw",
      },
      summaries: ["Withdraw 10 to 0x0471…938d"],
    };
    const html = approvalCard(approval, status);

    expect(html).toContain("Private transaction request");
    expect(html).toContain("Review each private action and the frozen execution call.");
    expect(html).toContain(
      "Wallet-funded public routes get a second exact-call network-fee review",
    );
    expect(html).toContain("sponsored private-relay routes submit after this approval");
    expect(html).toContain("Withdraw 10 to 0x0471…938d");
    expect(html).toContain("Exact action parameters");
    expect(html).toContain("Collect policy");
    expect(html).toContain("0x7");
    expect(html).toContain("0x1, 0x2");
    expect(html).toContain("Relay fee action · Withdrawal");
    expect(html).toContain("0x99");
    expect(html).toContain("3 actions · including relay fee");
    expect(html).toContain("public deposit approval");
    expect(html).toContain("Split the deposit and private actions");
    expect(html).toContain(`data-approval-action="deny" data-approval-id="${ID}"`);
  });

  for (const input of [
    {
      action: "Share balances",
      hint: "reveals only the listed private token balances",
      kind: "strk20-balances",
      title: "Private balance request",
    },
    {
      action: "Authorize",
      hint: "site can submit a returned proof",
      kind: "strk20-prepare",
      title: "Private proof request",
    },
    {
      action: "Activate",
      hint: "separate exact-call network-fee approval follows",
      kind: "strk20-register",
      title: "Activate private balances",
    },
    {
      action: "Share commitment",
      hint: "may link sessions for this site",
      kind: "strk20-subaccount",
      title: "Private identity request",
    },
  ] as const) {
    test(`${input.kind} explains the disclosure and binds the approval context`, () => {
      const approval: PendingApproval = {
        ...(input.kind === "strk20-prepare"
          ? {
              actionReviews: [{ calldata: ["0x1"], contract: "0x2", type: "invoke" as const }],
            }
          : {}),
        context: {
          accountId: account.id,
          chainId: "0x534e5f4d41494e",
          networkId: "SN_MAIN",
          payloadDigest: `sha256:${"a".repeat(64)}`,
        },
        id: ID,
        kind: input.kind,
        origin: ORIGIN,
        summaries: ["Exact private request"],
      };
      const html = approvalCard(approval, status);

      expect(html).toContain(input.title);
      expect(html).toContain(input.hint);
      expect(html).toContain("Exact private request");
      expect(html).toContain("Technical request identity");
      expect(html).toContain(input.action);
    });
  }

  test("empty-token balance disclosure explicitly means every private balance", () => {
    const html = approvalCard(
      {
        id: ID,
        kind: "strk20-balances",
        origin: ORIGIN,
        summaries: ["Share all private token balances"],
      },
      status,
    );

    expect(html).toContain("reveals every private token balance");
    expect(html).not.toContain("only the listed private token balances");
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
      declaration: {
        abiEntryCount: 14,
        accountDeployment: "undeployed",
        classHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
        compiledClassHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
        deploymentFee: { overallFee: "1500000000000000", unit: "FRI" },
        deploymentFeeEstimateFailed: false,
        entryPointCount: 9,
        fee: { overallFee: "2500000000000000", unit: "FRI" },
        feeEstimateFailed: false,
        sierraProgramLength: 4_321,
      },
    };
    const html = approvalCard(approval, lockedStatus);

    expect(html).toContain("Declare contract request");
    expect(html).toContain("Unlock the wallet to review and declare this contract class.");
    expect(html).toContain("Register Cairo 1 contract code");
    expect(html).toContain("0.0025 STRK");
    expect(html).toContain("0.0015 STRK");
    expect(html).toContain("0.004 STRK");
    expect(html).toContain("Required before declaration");
    expect(html).toContain("4,321 Sierra words · 14 ABI entries · 9 entry points");
    expect(html).toContain("additional STRK fee not included");
    expect(html).not.toContain("sierra_program");
    expect(html).toContain(`data-approval-id="${ID}" type="button" disabled`);

    const readyHtml = approvalCard(approval, status);
    expect(readyHtml).toContain('data-approval-fee="4000000000000000"');
    expect(readyHtml).not.toContain(`data-approval-id="${ID}" type="button" disabled`);

    const declaration = approval.declaration;
    if (!declaration) throw new Error("declare fixture missing");
    const unavailableHtml = approvalCard(
      {
        ...approval,
        declaration: { ...declaration, fee: null, feeEstimateFailed: true },
      },
      status,
    );
    expect(unavailableHtml).toContain("The declaration fee could not be estimated");
    expect(unavailableHtml).toContain(`data-approval-retry-fee="${ID}"`);
    expect(unavailableHtml).not.toContain("data-approval-fee=");
    expect(unavailableHtml).toContain(`data-approval-id="${ID}" type="button" disabled`);
  });

  test("watch-asset request without a token renders nothing", () => {
    const approval: PendingApproval = { id: ID, kind: "watch-asset", origin: ORIGIN };
    expect(approvalCard(approval, status)).toBe("");
  });
});
