/**
 * Dapp-facing STRK20 checkpoints. Every value is deterministic fixture data;
 * these stories never derive notes, request proofs, or contact a remote service.
 */
import type { PendingApproval } from "@mc-wallet/wallet-ui/popup/responses";
import { RECIPIENT_ADDRESS, softwareAccount, statusFor, USDC_ADDRESS } from "./fixtures";
import {
  ETH_TOKEN,
  journeyBalances,
  journeyPreferences,
  journeyPrices,
  STRK_TOKEN,
} from "./journey-fixtures";
import { walletDashboard } from "./scenario-dashboard";
import { prepareApprovalProcessing } from "./scenarios-approvals";
import type { FrameContext, WalletScenario } from "./types";

const TERMINAL_ORIGIN = "https://mc-wallet-terminal.vercel.app";
const DAPP_ORIGIN = "https://private-market.example";
const EXECUTOR = "0x0467890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const DAPP_ANONYMIZER = "0x0557890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const FEE_COLLECTOR = "0x0667890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const OPEN_NOTE_0 = `\${openNoteIds[0]}`;

const context = (marker: string) => ({
  accountId: softwareAccount.id,
  chainId: "0x534e5f4d41494e",
  networkId: "SN_MAIN",
  payloadDigest: `sha256:${marker.repeat(64)}`,
});

const approvalId = (suffix: string): string => `00000000-0000-4000-8000-000000000${suffix}`;

const relayFee = {
  amount: "0x38d7ea4c68000",
  recipient: FEE_COLLECTOR,
  token: STRK_TOKEN.address,
  type: "withdraw" as const,
};

const selectiveBalances: PendingApproval = {
  context: context("1"),
  id: approvalId("201"),
  kind: "strk20-balances",
  origin: TERMINAL_ORIGIN,
  summaries: ["Share private USDC and ETH balances", "No funds or notes will move"],
};

const allBalances: PendingApproval = {
  context: context("2"),
  id: approvalId("202"),
  insights: ["This request reveals every private token balance discovered for this account."],
  kind: "strk20-balances",
  origin: DAPP_ORIGIN,
  summaries: ["Share all private token balances", "No funds or notes will move"],
};

const prepareTransfer: PendingApproval = {
  actionReviews: [
    {
      amount: "0x17d7840",
      recipient: RECIPIENT_ADDRESS,
      token: USDC_ADDRESS,
      type: "transfer",
    },
  ],
  context: context("3"),
  id: approvalId("203"),
  kind: "strk20-prepare",
  origin: TERMINAL_ORIGIN,
  summaries: [
    "Prepare a proof to transfer 25 USDC privately",
    "The site receives a proof for this frozen action only",
  ],
};

const privateTransfer: PendingApproval = {
  actionReviews: [
    {
      amount: "0x17d7840",
      recipient: RECIPIENT_ADDRESS,
      token: USDC_ADDRESS,
      type: "transfer",
    },
  ],
  context: context("4"),
  id: approvalId("204"),
  kind: "strk20-invoke",
  origin: TERMINAL_ORIGIN,
  relayFeeAction: relayFee,
  summaries: [
    "Transfer 25 USDC privately to Research treasury",
    "Pay the private relay fee from the STRK private balance",
  ],
};

const privateWithdrawal: PendingApproval = {
  actionReviews: [
    {
      amount: "0x5f5e100",
      recipient: softwareAccount.address,
      token: USDC_ADDRESS,
      type: "withdraw",
    },
  ],
  context: context("5"),
  id: approvalId("205"),
  kind: "strk20-invoke",
  origin: TERMINAL_ORIGIN,
  relayFeeAction: relayFee,
  summaries: [
    "Withdraw 100 USDC to Daily account",
    "The public recipient and amount will be visible on Starknet",
  ],
};

const dappAnonymizer: PendingApproval = {
  actionReviews: [
    {
      amount: "OPEN",
      recipient: DAPP_ANONYMIZER,
      token: ETH_TOKEN.address,
      type: "transfer",
    },
    {
      calldata: [ETH_TOKEN.address, OPEN_NOTE_0, "0x1"],
      contract: DAPP_ANONYMIZER,
      type: "invoke",
    },
  ],
  context: context("6"),
  id: approvalId("206"),
  insights: [
    "This is a dapp-specific anonymizer. It consumes notes according to the dapp's own rules.",
  ],
  kind: "strk20-prepare",
  origin: DAPP_ORIGIN,
  summaries: [
    "Create one open ETH note for Private Market",
    "Invoke the reviewed Private Market anonymizer with that note",
  ],
};

const privateSwap: PendingApproval = {
  actionReviews: [
    {
      amount: "0x17d7840",
      recipient: EXECUTOR,
      token: USDC_ADDRESS,
      type: "withdraw",
    },
    relayFee,
    {
      amount: "OPEN",
      recipient: softwareAccount.address,
      token: ETH_TOKEN.address,
      type: "transfer",
    },
    {
      calldata: [ETH_TOKEN.address, "0x1", OPEN_NOTE_0],
      contract: EXECUTOR,
      type: "invoke",
    },
  ],
  context: context("7"),
  id: approvalId("207"),
  insights: ["The wallet verified the AVNU action order, executor, recipient, and fee token."],
  kind: "strk20-prepare",
  origin: TERMINAL_ORIGIN,
  summaries: [
    "Privately swap 25 USDC for at least 0.0068 ETH",
    "Receive the bought ETH as a new private note",
    "The route contains four frozen actions",
  ],
};

const subaccountIdentity: PendingApproval = {
  context: context("8"),
  id: approvalId("208"),
  insights: ["The commitment is deterministic for this site and may link future sessions here."],
  kind: "strk20-subaccount",
  origin: DAPP_ORIGIN,
  summaries: ["Share a site-scoped private identity commitment with Private Market"],
};

const subaccountInvoke: PendingApproval = {
  actionReviews: [
    {
      calls: [
        {
          calldata: [USDC_ADDRESS, "0x2faf080"],
          contract_address: EXECUTOR,
          entry_point: "open_position",
        },
      ],
      collect_policy: { type: "diff" },
      dapp_name: "Private Market",
      nonce: "0x9",
      type: "subaccount_invoke",
    },
  ],
  context: context("9"),
  id: approvalId("209"),
  insights: [
    "This route uses the separately configured SDK sub-account module, not a generic pool anonymizer.",
  ],
  kind: "strk20-prepare",
  origin: DAPP_ORIGIN,
  summaries: [
    "Open one Private Market position through the scoped sub-account",
    "Collect only the resulting balance difference into private notes",
  ],
};

const expandExactActions = (frame: FrameContext): void => {
  const details = [...frame.app.querySelectorAll<HTMLDetailsElement>("details")].find((item) =>
    item.querySelector("summary")?.textContent?.includes("Exact action parameters"),
  );
  if (!details) {
    throw new Error("Missing exact STRK20 action disclosure");
  }
  details.open = true;
};

const privacyRequest = (
  id: string,
  label: string,
  narrative: string,
  approval: PendingApproval,
  options: {
    readonly expanded?: boolean;
    readonly locked?: boolean;
    readonly processing?: boolean;
  } = {},
): WalletScenario["checkpoints"][number] => ({
  content: () =>
    walletDashboard({
      balanceState: { balances: journeyBalances },
      pending: [approval],
      preferences: journeyPreferences,
      prices: journeyPrices,
      status: options.locked ? { ...statusFor(), locked: true } : statusFor(),
      view: "requests",
    }),
  id,
  label,
  narrative,
  ...(options.processing
    ? { prepare: prepareApprovalProcessing }
    : options.expanded
      ? { prepare: expandExactActions }
      : {}),
  state: {
    account: softwareAccount.id,
    kind: approval.kind ?? "connect",
    parameters: options.expanded ? "expanded" : "collapsed",
    locked: options.locked ?? false,
    origin: approval.origin,
    processing: options.processing ?? false,
  },
});

export const privacyDappCheckpoints: WalletScenario["checkpoints"] = [
  privacyRequest(
    "balance-selective",
    "Share selected balances",
    "The site requests only named token totals; the review says explicitly that no funds or notes move.",
    selectiveBalances,
  ),
  privacyRequest(
    "balance-all",
    "Share every balance",
    "The broader disclosure is visually distinct and warns that every discovered private token total will be revealed.",
    allBalances,
  ),
  privacyRequest(
    "proof-transfer",
    "Prepare a private transfer",
    "Proof preparation freezes the exact private action while leaving submission with the requesting site.",
    prepareTransfer,
  ),
  privacyRequest(
    "transfer-review",
    "Review private transfer",
    "Recipient, token, amount, relay fee, account, network, and payload digest are available before approval.",
    privateTransfer,
  ),
  privacyRequest(
    "transfer-parameters",
    "Inspect transfer parameters",
    "The expanded review exposes the recipient, raw token and amount, relay withdrawal, account, network, and payload digest together.",
    privateTransfer,
    { expanded: true },
  ),
  privacyRequest(
    "transfer-processing",
    "Authorize private transfer",
    "The reviewed request locks while the wallet proves, authorizes, and submits it; a second approval cannot race it.",
    privateTransfer,
    { processing: true },
  ),
  privacyRequest(
    "withdrawal-review",
    "Review public withdrawal",
    "The wallet distinguishes a private spend from the public recipient and amount created by withdrawal.",
    privateWithdrawal,
  ),
  privacyRequest(
    "locked-request",
    "Unlock before private access",
    "A locked wallet keeps every private disclosure and action unavailable while preserving the request context.",
    privateTransfer,
    { locked: true },
  ),
  privacyRequest(
    "anonymizer-review",
    "Review dapp anonymizer",
    "The dapp-specific anonymizer is an explicit invoke target with its note placeholder and rules called out for review.",
    dappAnonymizer,
  ),
  privacyRequest(
    "anonymizer-parameters",
    "Inspect anonymizer parameters",
    "The expanded review makes the dapp-specific target, open-note placeholder, and complete calldata directly auditable.",
    dappAnonymizer,
    { expanded: true },
  ),
  privacyRequest(
    "private-swap-review",
    "Review private swap",
    "The AVNU route exposes the sell withdrawal, relay fee, open receive note, and executor invocation as four frozen actions.",
    privateSwap,
  ),
  privacyRequest(
    "private-swap-parameters",
    "Inspect private swap route",
    "The expanded route keeps all four AVNU actions visible in one immutable review state for snapshot comments.",
    privateSwap,
    { expanded: true },
  ),
  privacyRequest(
    "private-swap-processing",
    "Prepare private swap proof",
    "Approval locks the validated AVNU plan while proof generation runs; the server cannot substitute another route afterward.",
    privateSwap,
    { processing: true },
  ),
  privacyRequest(
    "subaccount-identity",
    "Share scoped identity",
    "The site-scoped commitment is reviewed as linkable identity disclosure rather than as a transaction.",
    subaccountIdentity,
  ),
  privacyRequest(
    "subaccount-invoke",
    "Review sub-account action",
    "The separately configured SDK module shows its dapp, nonce, calls, and collection policy before proof creation.",
    subaccountInvoke,
  ),
  privacyRequest(
    "subaccount-parameters",
    "Inspect sub-account parameters",
    "The expanded state exposes every scoped call, nonce, dapp name, and note-collection policy.",
    subaccountInvoke,
    { expanded: true },
  ),
];
