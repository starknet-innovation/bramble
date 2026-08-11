import type { MultisigProposalRecord } from "@mc-wallet/multisig/repository";
import {
  multisigAddFlow,
  multisigReceiveFlow,
  multisigSignersFlow,
  multisigTrackFlow,
  multisigWatchFlow,
} from "@mc-wallet/wallet-ui/sidepanel/multisig-management-views";
import { serializeMultisigReviewPackage } from "@mc-wallet/wallet-ui/sidepanel/multisig-model";
import { bindMultisigProposalForm } from "@mc-wallet/wallet-ui/sidepanel/multisig-proposal-ui";
import { createMultisigClient } from "@mc-wallet/wallet-ui/sidepanel/multisig-runtime";
import { bindMultisigs, type MultisigUiDeps } from "@mc-wallet/wallet-ui/sidepanel/multisig-ui";
import {
  multisigDeployFlow,
  multisigDetailFlow,
  multisigProposeFlow,
  multisigsFlow,
} from "@mc-wallet/wallet-ui/sidepanel/multisig-views";
import {
  balances,
  discoveredNft,
  multisig,
  pendingProposal,
  preferences,
  RECIPIENT_ADDRESS,
  softwareAccount,
  statusFor,
  USDC_ADDRESS,
} from "./fixtures";
import { walletDashboard } from "./scenario-dashboard";
import { updateForm } from "./scenario-runtime";
import { multisigReviewCheckpoints, showSharedTab } from "./scenarios-multisig-review";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "./types";

const multisigCheckpoint = (
  id: string,
  label: string,
  narrative: string,
  content: () => string,
  state: Readonly<Record<string, unknown>>,
  prepare?: (context: FrameContext) => void,
): ScenarioCheckpoint => ({
  content,
  id,
  label,
  narrative,
  ...(prepare ? { prepare } : {}),
  state,
});

const confirmedProposal: MultisigProposalRecord = {
  ...pendingProposal,
  confirmations: 2,
  confirmedBySigner: true,
  state: "confirmed",
};

const awaitingOwnedSigner: MultisigProposalRecord = {
  ...pendingProposal,
  confirmedBySigner: true,
  confirmedBySignerAddress: softwareAccount.address,
  confirmedSignerAddresses: [softwareAccount.address],
};

const untrackedProposal: MultisigProposalRecord = {
  ...pendingProposal,
  call: null,
  confirmations: 0,
  confirmedBySigner: false,
  id: `${multisig.id}:0x902`,
  summary: "Shared proposal — verify on explorer",
  txId: "0x902",
};

const executedProposal: MultisigProposalRecord = {
  ...confirmedProposal,
  confirmations: 2,
  id: `${multisig.id}:0x903`,
  state: "executed",
  summary: "Completed research payment",
  txId: "0x903",
};

const showAdvancedProposal = (context: FrameContext): void => {
  context.app.querySelectorAll<HTMLElement>("[data-proposal-stage-panel]").forEach((panel) => {
    const target = panel;
    target.hidden = target.dataset["proposalStagePanel"] !== "advanced";
  });
  const form = context.app.querySelector<HTMLFormElement>("#multisig-propose-form");
  if (form) form.dataset["proposalMode"] = "advanced";
  const options = context.app.querySelector<HTMLElement>("[data-proposal-options]");
  if (options) options.hidden = false;
};

const bindProposalJourney = (context: FrameContext): void => {
  const client = createMultisigClient({
    sendMessage: async () => ({ error: "UI Lab blocks proposal submission" }),
  });
  bindMultisigProposalForm({
    app: context.app,
    multisig: client,
    openDetail: () => context.emit({ detail: "return to shared account", kind: "state" }),
    runAction: () => undefined,
    selectedMultisigId: () => multisig.id,
    setResult: (id, message) => {
      const result = context.app.querySelector(`#${id}`);
      if (result) result.textContent = message;
    },
  });
};

const prepareProposal =
  (stage: "amount" | "review") =>
  (context: FrameContext): void => {
    bindProposalJourney(context);
    context.app
      .querySelector<HTMLButtonElement>(`[data-proposal-recipient="${RECIPIENT_ADDRESS}"]`)
      ?.click();
    updateForm(context, "#proposal-amount-input", "125");
    if (stage === "review") {
      context.app.querySelector<HTMLButtonElement>("#proposal-review-button")?.click();
    }
  };

const showDeploymentRules = (context: FrameContext): void => {
  context.app.querySelectorAll<HTMLElement>("[data-deploy-stage]").forEach((panel) => {
    const target = panel;
    target.hidden = target.dataset["deployStage"] !== "rules";
  });
};

const openSharedAccountDrawer = (context: FrameContext): void => {
  const drawer = context.app.querySelector<HTMLElement>(".drawer-root");
  if (drawer) drawer.dataset["open"] = "true";
};

const showSharedCollectibles = (context: FrameContext): void =>
  showSharedTab(context, "collectibles");

const showSharedProposals = (context: FrameContext): void => showSharedTab(context, "proposals");

const showConfirmationReview = (context: FrameContext): void => {
  bindMultisigs({
    app: context.app,
    multisig: {
      async confirmProposal() {
        throw new Error("UI Lab blocks transaction submission");
      },
      async prepareConfirmation(input: {
        mode: "confirm-and-execute" | "confirm-only";
        proposalId: string;
        signerAccountId: string;
      }) {
        return {
          fee: { overallFee: "240000000000000", unit: "FRI" },
          feeEstimateFailed: false,
          ...input,
        };
      },
    },
    openDetail: () => undefined,
    openList: () => undefined,
    render: async () => undefined,
    selectedMultisigId: () => multisig.id,
    wallet: {
      loadStatus: async () => statusFor(),
    },
  } as unknown as MultisigUiDeps);
  showSharedProposals(context);
  context.app.querySelector<HTMLButtonElement>("[data-ms-confirm-open]")?.click();
  context.emit({ detail: "Confirmation review opened", kind: "action" });
};

const showImportedReviewPackage = (context: FrameContext): void => {
  const input = context.app.querySelector<HTMLTextAreaElement>('textarea[name="reviewPackage"]');
  if (input) {
    input.value = serializeMultisigReviewPackage(multisig, pendingProposal);
  }
};

const portfolio = {
  balances: { balances },
  changes: { [USDC_ADDRESS]: 0.42 },
  currency: "usd" as const,
  nfts: [discoveredNft],
  prices: { [USDC_ADDRESS]: 1 },
};

export const multisigScenario: WalletScenario = {
  checkpoints: [
    multisigCheckpoint(
      "add",
      "Add a Multisig account",
      "Create and add-existing are separate tasks with explicit membership semantics.",
      () => multisigAddFlow(statusFor(), softwareAccount),
      { choices: ["create", "add-existing"], membershipChange: false },
    ),
    multisigCheckpoint(
      "list",
      "Watched multisigs",
      "The overview exposes quorum and open work before navigation.",
      () =>
        multisigsFlow(
          statusFor(),
          softwareAccount,
          [multisig],
          [pendingProposal],
          false,
          "current",
        ),
      { openProposals: 1, quorum: 2, sync: "current" },
    ),
    multisigCheckpoint(
      "watch",
      "Watch multisig",
      "Membership verification is isolated from the watched-contract list.",
      () => multisigWatchFlow(statusFor(), softwareAccount),
      { task: "watch", view: "multisig-watch" },
    ),
    multisigCheckpoint(
      "proposal",
      "Multisig home",
      "Shared value, quorum context, compact actions, and open work follow the familiar portfolio hierarchy.",
      () =>
        walletDashboard({
          balanceState: portfolio.balances,
          changes: portfolio.changes,
          multisigNfts: portfolio.nfts ?? [],
          multisigProposals: [pendingProposal],
          multisigSync: "current",
          multisigs: [multisig],
          selectedMultisigId: multisig.id,
          view: "multisig-home",
        }),
      { confirmations: 1, proposalId: pendingProposal.txId, state: "pending" },
    ),
    multisigCheckpoint(
      "proposal-search-recent",
      "Recent proposal search",
      "Fresh signer and quorum state remains usable while bounded event discovery is labelled separately.",
      () =>
        walletDashboard({
          balanceState: portfolio.balances,
          multisigProposals: [pendingProposal],
          multisigSync: "proposal-discovery-recent",
          multisigs: [multisig],
          selectedMultisigId: multisig.id,
          view: "multisig-home",
        }),
      { config: "current", proposalDiscovery: "recent" },
    ),
    {
      content: () =>
        walletDashboard({
          activity: [
            {
              accountId: multisig.id,
              hash: "0x904",
              kind: "invoke",
              networkId: "SN_MAIN",
              status: "accepted",
              submittedAt: 1_785_171_200_000,
              summary: "Propose: Pay 100 USDC to research treasury",
            },
          ],
          multisigs: [multisig],
          selectedMultisigId: multisig.id,
          view: "activity",
        }),
      id: "shared-activity",
      label: "Shared account activity",
      narrative:
        "The dock, header, export boundary, and transaction feed remain scoped to the shared account rather than the current signer.",
      state: { accountScope: multisig.id, signerBleed: false, view: "activity" },
    },
    multisigCheckpoint(
      "configuration-unavailable",
      "Configuration unavailable",
      "A fixed support code identifies the failed RPC lane without leaking endpoint details.",
      () =>
        walletDashboard({
          balanceState: portfolio.balances,
          multisigProposals: [pendingProposal],
          multisigSync: "configuration-unavailable",
          multisigs: [multisig],
          selectedMultisigId: multisig.id,
          view: "multisig-home",
        }),
      { config: "unavailable", supportCode: "MC-MS-CONFIG-RPC" },
    ),
    {
      content: () =>
        walletDashboard({
          balanceState: portfolio.balances,
          changes: portfolio.changes,
          multisigNfts: portfolio.nfts ?? [],
          multisigProposals: [pendingProposal],
          multisigSync: "current",
          multisigs: [multisig],
          selectedMultisigId: multisig.id,
          view: "multisig-home",
        }),
      id: "collectibles",
      label: "Shared collectibles",
      narrative:
        "Ownership-verified collectibles remain partitioned to the shared account beside its token portfolio.",
      prepare: showSharedCollectibles,
      state: { accountType: "shared", tab: "collectibles" },
    },
    {
      content: () =>
        walletDashboard({
          multisigProposals: [pendingProposal],
          multisigs: [multisig],
          selectedMultisigId: multisig.id,
          view: "multisig-home",
        }),
      id: "drawer",
      label: "Shared account in drawer",
      narrative:
        "Multisigs sit alongside single-signer accounts with explicit account type, threshold, and open-work heuristics.",
      prepare: openSharedAccountDrawer,
      state: { accountType: "shared", openProposals: 1, quorum: 2 },
    },
    {
      content: () =>
        walletDashboard({
          multisigProposals: [pendingProposal],
          multisigs: [multisig],
          selectedMultisigId: multisig.id,
          view: "account",
        }),
      id: "account-management",
      label: "Manage signer and Multisig accounts",
      narrative:
        "The account manager presents shared and signer accounts as peer identities while keeping their signing semantics explicit.",
      state: { accountTypes: ["signer", "multisig"], selected: multisig.id },
    },
    ...multisigReviewCheckpoints(portfolio),
    {
      content: () =>
        walletDashboard({
          balanceState: portfolio.balances,
          changes: portfolio.changes,
          multisigNfts: portfolio.nfts ?? [],
          multisigProposals: [awaitingOwnedSigner],
          multisigSync: "current",
          multisigs: [multisig],
          selectedMultisigId: multisig.id,
          view: "multisig-home",
        }),
      id: "confirm-owned-signer",
      label: "Confirm with an owned signer",
      narrative:
        "The wallet intersects on-chain signer rules with locally-owned accounts, excludes a signer already confirmed, and requires a focused review before signing.",
      prepare: showConfirmationReview,
      state: {
        alreadyConfirmed: softwareAccount.id,
        eligibleSigners: 2,
        reviewRequired: true,
      },
    },
    multisigCheckpoint(
      "receive",
      "Receive to shared account",
      "The QR and copy action use the Multisig contract address, never the active signer's address.",
      () => multisigReceiveFlow(statusFor(), multisig),
      { addressScope: "multisig", view: "multisig-receive" },
    ),
    multisigCheckpoint(
      "signers",
      "Signers and quorum",
      "Membership and threshold inspection no longer compete with proposal actions.",
      () => multisigSignersFlow(statusFor(), softwareAccount, multisig),
      { quorum: 2, signers: 3, view: "multisig-signers" },
    ),
    multisigCheckpoint(
      "track",
      "Track shared proposal",
      "A pasted id remains call-less and requires explicit independent verification before signing.",
      () => multisigTrackFlow(statusFor(), multisig),
      { noteTrust: "local only", view: "multisig-track" },
    ),
    {
      content: () => multisigTrackFlow(statusFor(), multisig),
      id: "track-package",
      label: "Import review package",
      narrative:
        "A secret-free package restores the exact public call only after the background re-hashes it through the selected multisig contract.",
      prepare: showImportedReviewPackage,
      state: {
        callTrust: "contract-derived id match",
        networkRequests: "hash_transaction and proposal views",
        packageSecrets: 0,
      },
    },
    multisigCheckpoint(
      "ready",
      "Ready to execute",
      "Reaching quorum changes the next action without hiding the reviewed call.",
      () =>
        multisigDetailFlow(
          statusFor(),
          softwareAccount,
          multisig,
          [confirmedProposal],
          false,
          "current",
          preferences,
          "multisig-home",
          portfolio,
        ),
      { confirmations: 2, proposalId: pendingProposal.txId, state: "confirmed" },
    ),
    {
      content: () =>
        multisigDetailFlow(
          statusFor(),
          softwareAccount,
          multisig,
          [confirmedProposal],
          false,
          "current",
          preferences,
          "multisig-home",
          portfolio,
        ),
      id: "ready-proposal",
      label: "Ready proposal detail",
      narrative:
        "The proposal tab keeps the decoded action and quorum-sensitive next step one deliberate click away from the shared portfolio.",
      prepare: showSharedProposals,
      state: { confirmations: 2, proposalId: pendingProposal.txId, tab: "proposals" },
    },
    multisigCheckpoint(
      "registry-unavailable",
      "Registry unavailable",
      "Cached public data remains visible with a fixed background-registry support code and retry path.",
      () =>
        multisigDetailFlow(
          statusFor(),
          softwareAccount,
          multisig,
          [pendingProposal],
          true,
          "background-unavailable",
          preferences,
          "multisig-home",
          portfolio,
        ),
      { cached: true, sync: "background-unavailable" },
    ),
    multisigCheckpoint(
      "propose",
      "Create guided proposal",
      "A familiar token transfer is primary while arbitrary calldata remains an explicit advanced path.",
      () => multisigProposeFlow(statusFor(), multisig, preferences, portfolio),
      { action: "send-token", calldata: "derived and reviewed", view: "multisig-propose" },
      bindProposalJourney,
    ),
    {
      content: () => multisigProposeFlow(statusFor(), multisig, preferences, portfolio),
      id: "propose-amount",
      label: "Proposal token and amount",
      narrative:
        "Token, amount, shared balance, recipient, network, and source account stay in one focused decision.",
      prepare: prepareProposal("amount"),
      state: { amount: "125 USDC", recipient: "Research treasury", stage: "amount" },
    },
    {
      content: () => multisigProposeFlow(statusFor(), multisig, preferences, portfolio),
      id: "propose-review",
      label: "Review transfer proposal",
      narrative:
        "The common transfer summary leads; decoded contract parameters remain available without dominating the task.",
      prepare: prepareProposal("review"),
      state: { call: "USDC.transfer", reviewRequired: true, stage: "review" },
    },
    {
      content: () => multisigProposeFlow(statusFor(), multisig, preferences, portfolio),
      id: "propose-advanced",
      label: "Advanced contract proposal",
      narrative:
        "Raw target, method, and calldata are still available without competing with the common transfer path.",
      prepare: showAdvancedProposal,
      state: { mode: "advanced", rawCalldata: true },
    },
    multisigCheckpoint(
      "deploy-checking",
      "Check deploy class",
      "Deployment remains disabled until the pinned class status resolves.",
      () => multisigDeployFlow(statusFor(), softwareAccount, null, preferences),
      { class: "checking", view: "multisig-deploy" },
    ),
    multisigCheckpoint(
      "deploy-declare",
      "Declare before deploy",
      "A missing class exposes the one-time declaration and its fee-bearing boundary.",
      () =>
        multisigDeployFlow(
          statusFor(),
          softwareAccount,
          { declarationPending: false, declared: false },
          preferences,
        ),
      { class: "missing", deployEnabled: false },
    ),
    multisigCheckpoint(
      "deploy-declaration-pending",
      "Declaration pending",
      "The submitted transaction stays visible and deployment remains locked until the pinned class is confirmed on-chain.",
      () =>
        multisigDeployFlow(
          statusFor(),
          softwareAccount,
          {
            declarationPending: true,
            declared: false,
            transactionHash: "0xdec",
          },
          preferences,
        ),
      { class: "pending", deployEnabled: false, transactionHash: "0xdec" },
    ),
    multisigCheckpoint(
      "deploy-ready",
      "Deploy ready",
      "Wallet accounts and contacts form a staged signer picker before quorum and deterministic salt review.",
      () =>
        multisigDeployFlow(
          statusFor(),
          softwareAccount,
          { declarationPending: false, declared: true },
          preferences,
        ),
      { class: "declared", deployEnabled: true, signerSources: ["wallet", "address-book"] },
    ),
    {
      content: () =>
        multisigDeployFlow(
          statusFor(),
          softwareAccount,
          { declarationPending: false, declared: true },
          preferences,
        ),
      id: "deploy-rules",
      label: "Review signer rules",
      narrative:
        "The final deployment view aggregates the selected signer set, quorum, and salt without the chooser competing for space.",
      prepare: showDeploymentRules,
      state: { approvals: "1 of 1", stage: "rules" },
    },
    multisigCheckpoint(
      "shared-untracked",
      "Untracked proposal",
      "A pasted proposal id requires explicit external verification before signing.",
      () =>
        multisigDetailFlow(
          statusFor(),
          softwareAccount,
          multisig,
          [untrackedProposal],
          false,
          "current",
          preferences,
          "multisig-home",
          portfolio,
        ),
      { call: "unavailable", verificationAcknowledgement: true },
    ),
    multisigCheckpoint(
      "executed",
      "Executed proposal",
      "Final state remains readable and removes actions that no longer apply.",
      () =>
        multisigDetailFlow(
          statusFor(),
          softwareAccount,
          multisig,
          [executedProposal],
          false,
          "current",
          preferences,
          "multisig-home",
          portfolio,
        ),
      { actionsAvailable: false, state: "executed" },
    ),
  ],
  description:
    "Shared-account home, guided proposal and deployment flows, decoded effects, independent review, quorum transitions, and degraded refresh state.",
  id: "multisig",
  surface: "sidepanel",
  title: "Multisig operations",
  views: [
    "multisigs",
    "multisig-add",
    "multisig-watch",
    "multisig-home",
    "multisig-detail",
    "multisig-signers",
    "multisig-track",
    "multisig-receive",
    "multisig-propose",
    "multisig-deploy",
  ],
};
