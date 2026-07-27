import {
  multisigDeployFlow,
  multisigDetailFlow,
  multisigProposeFlow,
  multisigsFlow,
} from "../../../src/sidepanel/multisig-views";
import { bindNfts } from "../../../src/sidepanel/nft-ui";
import { nftDetailFlow, nftGalleryFlow } from "../../../src/sidepanel/nft-views";
import { createSidepanelRuntime } from "../../../src/sidepanel/runtime";
import type { MultisigProposalRecord } from "../../../src/storage/multisig-store";
import {
  discoveredNft,
  invokeApproval,
  multisig,
  NFT_CONTRACT,
  nftId,
  pendingProposal,
  preferences,
  RECIPIENT_ADDRESS,
  secondAccount,
  secondActivity,
  softwareAccount,
  softwareActivity,
  statusFor,
  watchAssetApproval,
} from "./fixtures";
import { walletDashboard } from "./scenario-dashboard";
import { messageType, nextTurn, updateForm } from "./scenario-runtime";
import { approvalsScenario } from "./scenarios-approvals";
import {
  ledgerOnboardingScenario,
  onboardingScenario,
  unlockScenario,
} from "./scenarios-onboarding";
import { ledgerScenario, sendScenario } from "./scenarios-signing";
import { swapScenario } from "./scenarios-swap";
import { assetsScenario, portfolioScenario, settingsScenario } from "./scenarios-wallet";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "./types";

const NFT_HASH = `0x02${"b".repeat(62)}`;

const dappScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => walletDashboard(),
      id: "wallet",
      label: "Wallet in use",
      narrative: "The user may be anywhere in the wallet when a request arrives.",
      state: { foreground: "home", pending: 0 },
    },
    {
      content: () => walletDashboard({ pending: [invokeApproval], view: "settings" }),
      id: "takeover",
      label: "Request takeover",
      narrative: "A fresh transaction request supersedes the prior wallet screen.",
      state: { foreground: "approval", origin: invokeApproval.origin, pending: 1 },
    },
    {
      content: () =>
        walletDashboard({
          pending: [watchAssetApproval],
          status: statusFor(secondAccount),
          view: "send",
        }),
      id: "watch-asset",
      label: "Receipt token",
      narrative: "A wallet_watchAsset request takes focus and identifies the token precisely.",
      state: { foreground: "approval", kind: "watch-asset", pending: 1 },
    },
    {
      content: () =>
        walletDashboard({
          pending: [invokeApproval],
          snoozed: [invokeApproval.id],
          view: "activity",
        }),
      id: "snoozed",
      label: "Review later",
      narrative: "Snoozing returns control while keeping the request visible in Activity.",
      state: { foreground: "activity", pending: 1, snoozed: 1 },
    },
  ],
  description:
    "External requests preempt stale wallet navigation, remain reviewable, and can be explicitly parked.",
  id: "dapp",
  surface: "popup",
  title: "dApp request takeover",
};

const activityScenario: WalletScenario = {
  checkpoints: [
    {
      content: () =>
        walletDashboard({
          activity: softwareActivity,
          status: statusFor(softwareAccount),
          view: "activity",
        }),
      id: "account-a",
      label: "Daily account",
      narrative: "Only the active account's accepted transactions are rendered.",
      state: { accountId: softwareAccount.id, entries: 2, scope: "SN_MAIN" },
    },
    {
      content: () =>
        walletDashboard({ activity: [], status: statusFor(secondAccount), view: "activity" }),
      id: "scope-cleared",
      label: "Switch boundary",
      narrative: "The old lane clears immediately while the new account refreshes.",
      state: { accountId: secondAccount.id, entries: 0, loading: true, scope: "SN_MAIN" },
    },
    {
      content: () =>
        walletDashboard({
          activity: secondActivity,
          status: statusFor(secondAccount),
          view: "activity",
        }),
      id: "account-b",
      label: "Trading account",
      narrative: "The second account receives its own isolated activity snapshot.",
      state: { accountId: secondAccount.id, entries: 1, scope: "SN_MAIN" },
    },
    {
      content: () =>
        walletDashboard({
          activity: softwareActivity,
          status: statusFor(softwareAccount),
          view: "activity",
        }),
      id: "account-a-restored",
      label: "Switch back",
      narrative: "Returning restores account A without any rows from account B.",
      state: { accountId: softwareAccount.id, entries: 2, foreignEntries: 0, scope: "SN_MAIN" },
    },
  ],
  description:
    "Account and network scope changes clear stale rows before restoring the correct activity lane.",
  id: "activity",
  surface: "sidepanel",
  title: "Account-isolated Activity",
  views: ["activity"],
};

type NftMode = "blocked" | "review" | "submitted";

const prepareNft =
  (mode: NftMode) =>
  async (context: FrameContext): Promise<void> => {
    const wallet = createSidepanelRuntime({
      sendMessage: async (message) => {
        const type = messageType(message);
        context.emit({ detail: type ?? "invalid request", kind: "action" });
        if (type === "wallet.reviewNftTransfer") {
          const blocked = mode === "blocked";
          return {
            ok: true,
            review: {
              fee: { overallFee: "1800000000000000", unit: "FRI" },
              feeEstimateFailed: false,
              flags: blocked
                ? [{ code: "address-poisoning", message: "Recipient resembles a recent address." }]
                : [],
              requiresDeployment: false,
              summaries: ["Transfer MC Test Collection #342", `Recipient ${RECIPIENT_ADDRESS}`],
            },
          };
        }
        if (type === "wallet.transferNft" && mode === "submitted") {
          return { ok: true, transactionHash: NFT_HASH };
        }
        return { error: "UI Lab blocks non-fixture runtime requests" };
      },
    });
    bindNfts({
      app: context.app,
      openDetail: () => undefined,
      render: async () => undefined,
      wallet,
    });
    updateForm(context, '#nft-send-form input[name="recipient"]', RECIPIENT_ADDRESS);
    const form = context.app.querySelector<HTMLFormElement>("#nft-send-form");
    if (!form) {
      throw new Error("Missing production NFT send form");
    }
    form.requestSubmit();
    await nextTurn();
    if (mode === "submitted") {
      form.requestSubmit();
      await nextTurn();
    }
  };

const nftScenario: WalletScenario = {
  checkpoints: [
    {
      content: () =>
        nftGalleryFlow(statusFor(), softwareAccount, preferences, [
          { ...discoveredNft, image: "" },
        ]),
      id: "metadata-loading",
      label: "Metadata loading",
      narrative: "The owned token remains identifiable while artwork is not yet resolved.",
      state: { artwork: "pending", metadata: "cached", tokenId: "342" },
    },
    {
      content: () => nftGalleryFlow(statusFor(), softwareAccount, preferences, [discoveredNft]),
      id: "gallery",
      label: "Gallery ready",
      narrative: "The production gallery presents the full-size fixture artwork and collection.",
      state: { artwork: "local fixture", metadata: "ready", tokenId: "342" },
    },
    {
      content: () =>
        nftDetailFlow(statusFor(), softwareAccount, preferences, nftId, [discoveredNft]),
      id: "detail",
      label: "NFT detail",
      narrative: "Artwork, attributes, identifiers, and the guarded Send entry share one view.",
      state: { attributes: 3, owner: softwareAccount.id, tokenId: "342" },
    },
    {
      content: () =>
        nftDetailFlow(statusFor(), softwareAccount, preferences, nftId, [discoveredNft]),
      id: "review",
      label: "Transfer review",
      narrative: "The real NFT binding requires a decoded review before confirmation.",
      prepare: prepareNft("review"),
      state: { contract: NFT_CONTRACT, review: "ready", tokenId: "342" },
    },
    {
      content: () =>
        nftDetailFlow(statusFor(), softwareAccount, preferences, nftId, [discoveredNft]),
      id: "blocked",
      label: "Recipient blocked",
      narrative: "An address-poisoning flag prevents the confirmation state.",
      prepare: prepareNft("blocked"),
      state: { blocked: true, reason: "address-poisoning", tokenId: "342" },
    },
    {
      content: () =>
        nftDetailFlow(statusFor(), softwareAccount, preferences, nftId, [discoveredNft]),
      id: "submitted",
      label: "Transfer submitted",
      narrative: "Confirmation returns a transaction hash and never bypasses review.",
      prepare: prepareNft("submitted"),
      state: { review: "passed", transactionHash: NFT_HASH },
    },
  ],
  description:
    "NFT metadata arrival, gallery and detail quality, guarded transfer review, blocking, and submission.",
  id: "nft",
  surface: "sidepanel",
  title: "NFT loading and send",
  views: ["nfts", "nft-detail"],
};

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

const multisigScenario: WalletScenario = {
  checkpoints: [
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
      "proposal",
      "Proposal detail",
      "Exact calldata, signer state, and confirmation progress stay together.",
      () =>
        multisigDetailFlow(
          statusFor(),
          softwareAccount,
          multisig,
          [pendingProposal],
          false,
          "current",
        ),
      { confirmations: 1, proposalId: pendingProposal.txId, state: "pending" },
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
        ),
      { confirmations: 2, proposalId: pendingProposal.txId, state: "confirmed" },
    ),
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
        ),
      { cached: true, sync: "error" },
    ),
    multisigCheckpoint(
      "propose",
      "Create proposal",
      "Contract, entrypoint, calldata, salt, and note form the exact single-call proposal.",
      () => multisigProposeFlow(statusFor(), multisig),
      { calldata: "explicit", view: "multisig-propose" },
    ),
    multisigCheckpoint(
      "deploy-checking",
      "Check deploy class",
      "Deployment remains disabled until the pinned class status resolves.",
      () => multisigDeployFlow(statusFor(), softwareAccount, null),
      { class: "checking", view: "multisig-deploy" },
    ),
    multisigCheckpoint(
      "deploy-declare",
      "Declare before deploy",
      "A missing class exposes the one-time declaration and its fee-bearing boundary.",
      () => multisigDeployFlow(statusFor(), softwareAccount, false),
      { class: "missing", deployEnabled: false },
    ),
    multisigCheckpoint(
      "deploy-ready",
      "Deploy ready",
      "Signer, quorum, deterministic salt, and local hardware badges are ready for review.",
      () => multisigDeployFlow(statusFor(), softwareAccount, true),
      { class: "declared", deployEnabled: true },
    ),
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
        ),
      { actionsAvailable: false, state: "executed" },
    ),
  ],
  description:
    "Watched multisig overview, decoded proposal detail, quorum transition, and degraded refresh state.",
  id: "multisig",
  surface: "sidepanel",
  title: "Multisig operations",
  views: ["multisigs", "multisig-detail", "multisig-propose", "multisig-deploy"],
};

export const walletScenarios: readonly WalletScenario[] = [
  onboardingScenario,
  unlockScenario,
  portfolioScenario,
  sendScenario,
  swapScenario,
  ledgerScenario,
  ledgerOnboardingScenario,
  approvalsScenario,
  dappScenario,
  activityScenario,
  assetsScenario,
  nftScenario,
  multisigScenario,
  settingsScenario,
];

export const walletScenario = (id: string): WalletScenario =>
  walletScenarios.find((scenario) => scenario.id === id) ?? sendScenario;
