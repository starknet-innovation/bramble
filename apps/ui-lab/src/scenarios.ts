import type { DiscoveredNft, PendingApproval, WalletStatus } from "../../../src/popup/responses";
import { multisigDetailFlow, multisigsFlow } from "../../../src/sidepanel/multisig-views";
import { bindNfts } from "../../../src/sidepanel/nft-ui";
import { nftDetailFlow, nftGalleryFlow } from "../../../src/sidepanel/nft-views";
import { type BalanceState, createSidepanelRuntime } from "../../../src/sidepanel/runtime";
import { dashboard, type WalletView } from "../../../src/sidepanel/views";
import type { ActivityEntry } from "../../../src/storage/activity-store";
import type { MultisigProposalRecord } from "../../../src/storage/multisig-store";
import type { WalletPreferences } from "../../../src/storage/preferences-store";
import {
  balances,
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
  USDC_ADDRESS,
  watchAssetApproval,
} from "./fixtures";
import { messageType, nextTurn, updateForm } from "./scenario-runtime";
import { ledgerScenario, sendScenario } from "./scenarios-signing";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "./types";

const NFT_HASH = `0x02${"b".repeat(62)}`;
const fixtureBalances: BalanceState = { balances };
const prices = { [USDC_ADDRESS]: 1 };

type DashboardOptions = {
  readonly activity?: readonly ActivityEntry[];
  readonly discoveredNfts?: readonly DiscoveredNft[];
  readonly pending?: readonly PendingApproval[];
  readonly preferences?: WalletPreferences;
  readonly snoozed?: readonly string[];
  readonly status?: WalletStatus;
  readonly view?: WalletView;
};

const walletDashboard = (options: DashboardOptions = {}): string =>
  dashboard(
    options.view ?? "home",
    options.status ?? statusFor(),
    options.pending ?? [],
    options.preferences ?? preferences,
    fixtureBalances,
    true,
    options.activity ?? softwareActivity,
    [],
    prices,
    [],
    null,
    [],
    null,
    {},
    [],
    [],
    null,
    null,
    null,
    null,
    false,
    null,
    options.discoveredNfts ?? [discoveredNft],
    null,
    null,
    false,
    options.snoozed ?? [],
  );

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
  ],
  description:
    "Watched multisig overview, decoded proposal detail, quorum transition, and degraded refresh state.",
  id: "multisig",
  surface: "sidepanel",
  title: "Multisig operations",
};

export const walletScenarios: readonly WalletScenario[] = [
  sendScenario,
  ledgerScenario,
  dappScenario,
  activityScenario,
  nftScenario,
  multisigScenario,
];

export const walletScenario = (id: string): WalletScenario =>
  walletScenarios.find((scenario) => scenario.id === id) ?? sendScenario;
