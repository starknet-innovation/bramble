import {
  multisigAddFlow,
  multisigReceiveFlow,
  multisigSignersFlow,
  multisigTrackFlow,
  multisigWatchFlow,
} from "../../../src/sidepanel/multisig-management-views";
import { bindMultisigProposalForm } from "../../../src/sidepanel/multisig-proposal-ui";
import { createMultisigClient } from "../../../src/sidepanel/multisig-runtime";
import {
  multisigDeployFlow,
  multisigDetailFlow,
  multisigProposeFlow,
  multisigsFlow,
} from "../../../src/sidepanel/multisig-views";
import type { MultisigProposalRecord } from "../../../src/storage/multisig-store";
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
): ScenarioCheckpoint => ({ content, id, label, narrative, state });

const confirmedProposal: MultisigProposalRecord = {
  ...pendingProposal,
  confirmations: 2,
  confirmedBySigner: true,
  state: "confirmed",
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

const prepareProposal =
  (stage: "amount" | "review") =>
  (context: FrameContext): void => {
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
        multisigDetailFlow(
          statusFor(),
          softwareAccount,
          multisig,
          [pendingProposal],
          false,
          "current",
          preferences,
          "multisig-home",
          portfolio,
        ),
      { confirmations: 1, proposalId: pendingProposal.txId, state: "pending" },
    ),
    {
      content: () =>
        multisigDetailFlow(
          statusFor(),
          softwareAccount,
          multisig,
          [pendingProposal],
          false,
          "current",
          preferences,
          "multisig-home",
          portfolio,
        ),
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
        }),
      id: "drawer",
      label: "Shared account in drawer",
      narrative:
        "Multisigs are visually separated from single-signer accounts with threshold and open-work heuristics.",
      prepare: openSharedAccountDrawer,
      state: { accountType: "shared", openProposals: 1, quorum: 2 },
    },
    ...multisigReviewCheckpoints(portfolio),
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
      "A pasted id and its off-chain-note warning form one focused task.",
      () => multisigTrackFlow(statusFor(), multisig),
      { noteTrust: "local only", view: "multisig-track" },
    ),
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
      "sync-error",
      "Refresh failed",
      "Cached public data remains visible with an honest retry path.",
      () =>
        multisigDetailFlow(
          statusFor(),
          softwareAccount,
          multisig,
          [pendingProposal],
          true,
          "error",
          preferences,
          "multisig-home",
          portfolio,
        ),
      { cached: true, sync: "error" },
    ),
    multisigCheckpoint(
      "propose",
      "Create guided proposal",
      "A familiar token transfer is primary while arbitrary calldata remains an explicit advanced path.",
      () => multisigProposeFlow(statusFor(), multisig, preferences, portfolio),
      { action: "send-token", calldata: "derived and reviewed", view: "multisig-propose" },
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
      () => multisigDeployFlow(statusFor(), softwareAccount, false, preferences),
      { class: "missing", deployEnabled: false },
    ),
    multisigCheckpoint(
      "deploy-ready",
      "Deploy ready",
      "Wallet accounts and contacts form a staged signer picker before quorum and deterministic salt review.",
      () => multisigDeployFlow(statusFor(), softwareAccount, true, preferences),
      { class: "declared", deployEnabled: true, signerSources: ["wallet", "address-book"] },
    ),
    {
      content: () => multisigDeployFlow(statusFor(), softwareAccount, true, preferences),
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
