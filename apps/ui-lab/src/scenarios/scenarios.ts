import {
  bindActivity,
  bindNfts,
  createSidepanelRuntime,
  nftDetailFlow,
  nftGalleryFlow,
  nftSendFlow,
  type SidepanelWallet,
} from "@bramble/wallet-ui/lab";
import {
  discoveredNft,
  invokeApproval,
  NFT_CONTRACT,
  nftId,
  preferences,
  RECIPIENT_ADDRESS,
  secondAccount,
  secondActivity,
  softwareAccount,
  softwareActivity,
  statusFor,
  watchAssetApproval,
} from "../fixtures/fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import { messageType, nextTurn, updateForm } from "../runtime/scenario-runtime";
import type { FrameContext, WalletScenario } from "../runtime/types";
import { approvalsScenario } from "./scenarios-approvals";
import { multisigScenario } from "./scenarios-multisig";
import { ledgerOnboardingScenario, onboardingScenario } from "./scenarios-onboarding";
import { privacyScenario } from "./scenarios-privacy";
import { settingsScenario } from "./scenarios-settings";
import { ledgerScenario, sendScenario } from "./scenarios-signing";
import { swapScenario } from "./scenarios-swap";
import { unlockScenario } from "./scenarios-unlock";
import { assetsScenario, portfolioScenario } from "./scenarios-wallet";

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
    {
      content: () =>
        walletDashboard({
          pending: [invokeApproval],
          snoozed: [invokeApproval.id],
          view: "requests",
        }),
      id: "parked-list",
      label: "Parked request list",
      narrative: "Parked decisions live one level below account-scoped transaction activity.",
      state: { foreground: "requests", pending: 1, snoozed: 1 },
    },
  ],
  description:
    "External requests preempt stale wallet navigation, remain reviewable, and can be explicitly parked.",
  id: "dapp",
  surface: "sidepanel",
  title: "dApp request takeover",
  views: ["requests"],
};

// The feed's filter, search and sort controls are production bindings. The lab
// cannot repaint a dock screen by itself, so the fixture hands the binding the
// same local repaint the shell passes in production; the sort control then
// reshapes the feed exactly as it does in the app. The fixture runtime still
// answers the status read the refresh control asks for.
const activityFrameContent = (): string =>
  walletDashboard({
    activity: softwareActivity,
    status: statusFor(softwareAccount),
    view: "activity",
  });

const bindActivityControls = (context: FrameContext): void => {
  const app = context.app;
  const repaint = (): void => {
    app.innerHTML = activityFrameContent();
    bindActivityControls(context);
  };
  bindActivity({
    app,
    render: async () => repaint(),
    repaint,
    wallet: {
      loadStatus: async () => statusFor(softwareAccount),
    } as unknown as SidepanelWallet,
  });
};

// A stored recipient address typed into the search box, which is how a saved
// name or an address collapses the feed onto one counterparty.
const searchActivityAddress = (context: FrameContext): void => {
  bindActivityControls(context);
  const input = context.app.querySelector<HTMLInputElement>("#activity-search");
  if (!input) {
    throw new Error("Missing production activity search");
  }
  input.value = RECIPIENT_ADDRESS;
  input.dispatchEvent(new Event("input"));
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
      state: { accountId: softwareAccount.id, entries: 5, scope: "SN_MAIN" },
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
      state: { accountId: softwareAccount.id, entries: 5, foreignEntries: 0, scope: "SN_MAIN" },
    },
    {
      content: activityFrameContent,
      id: "filters",
      label: "Feed filters",
      narrative:
        "Type, status, token, sort and search controls sit above the feed, offering only the values the account's own records carry.",
      prepare: bindActivityControls,
      state: { controls: 5, sort: "date" },
    },
    {
      content: activityFrameContent,
      id: "filters-search",
      label: "Search one counterparty",
      narrative:
        "An address or saved name in the search box collapses the feed onto that counterparty and totals what was sent and received.",
      prepare: searchActivityAddress,
      state: { counterparty: "Research treasury", query: "recipient address" },
    },
  ],
  description:
    "Account and network scope changes clear stale rows before restoring the correct activity lane.",
  id: "activity",
  surface: "sidepanel",
  title: "Account-isolated Activity",
  views: ["activity"],
};

// `failed` submits like `submitted`, but the fixture chain reverts the transfer.
type NftMode = "blocked" | "failed" | "review" | "submitted";

const prepareNft =
  (mode: NftMode) =>
  async (context: FrameContext): Promise<void> => {
    const submits = mode === "submitted" || mode === "failed";
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
              feeAffordability: "ok",
              feeEstimateFailed: false,
              flags: blocked
                ? [{ code: "address-poisoning", message: "Recipient resembles a recent address." }]
                : [],
              requiresDeployment: false,
              summaries: [
                "Transfer Bramble Test Collection #342",
                `Recipient ${RECIPIENT_ADDRESS}`,
              ],
            },
          };
        }
        if (type === "wallet.transferNft" && submits) {
          return { ok: true, transactionHash: NFT_HASH };
        }
        // The receipt reads the network off the live status: without it the
        // hash has no explorer link, which is how a reader looks a failure up.
        if (type === "wallet.status") {
          return statusFor();
        }
        if (type === "wallet.activity") {
          return {
            activity: [
              {
                accountId: softwareAccount.id,
                hash: NFT_HASH,
                kind: "transfer" as const,
                networkId: "SN_MAIN" as const,
                status: mode === "failed" ? ("reverted" as const) : ("preconfirmed" as const),
                submittedAt: 1,
                summary: "Transfer Bramble Test Collection #342",
              },
            ],
            historyUnavailable: false,
            ok: true,
          };
        }
        return { error: "UI Lab blocks non-fixture runtime requests" };
      },
    });
    bindNfts({
      app: context.app,
      // The lab has no wall clock to spend: the fixture chain answers at once.
      confirmationDelaysMs: [0],
      // The receipt's ways off report to the event log, as Swap's do.
      navigate: (view) => context.emit({ detail: `navigate ${view}`, kind: "state" }),
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
    if (submits) {
      form.requestSubmit();
      await nextTurn();
      await nextTurn();
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
      narrative: "Artwork, attributes, and identifiers lead to a dedicated guarded Send journey.",
      state: { attributes: 3, owner: softwareAccount.id, tokenId: "342" },
    },
    {
      content: () => walletDashboard({ preferences, view: "nft-watch" }),
      id: "watch",
      label: "Watch by contract",
      narrative: "Manual collectible tracking is isolated around ownership verification.",
      state: { ownershipCheck: true, view: "nft-watch" },
    },
    {
      content: () => walletDashboard({ preferences, view: "nft-hidden" }),
      id: "hidden",
      label: "Hidden collectibles",
      narrative: "Spam and hidden-token recovery no longer crowds the gallery.",
      state: { task: "hidden management", view: "nft-hidden" },
    },
    {
      content: () => nftSendFlow(statusFor(), softwareAccount, preferences, nftId, [discoveredNft]),
      id: "recipient",
      label: "Choose recipient",
      narrative: "Collection identity, address entry, and saved recipients define who receives it.",
      state: { stage: "recipient", tokenId: "342" },
    },
    {
      content: () => nftSendFlow(statusFor(), softwareAccount, preferences, nftId, [discoveredNft]),
      id: "review",
      label: "Transfer review",
      narrative: "The real NFT binding requires a decoded review before confirmation.",
      prepare: prepareNft("review"),
      state: { contract: NFT_CONTRACT, review: "ready", tokenId: "342" },
    },
    {
      content: () => nftSendFlow(statusFor(), softwareAccount, preferences, nftId, [discoveredNft]),
      id: "blocked",
      label: "Recipient blocked",
      narrative: "An address-poisoning flag prevents the confirmation state.",
      prepare: prepareNft("blocked"),
      state: { blocked: true, reason: "address-poisoning", tokenId: "342" },
    },
    {
      content: () => nftSendFlow(statusFor(), softwareAccount, preferences, nftId, [discoveredNft]),
      // The id predates the receipt waiting for the chain; the fixture chain
      // confirms at once, so the checkpoint is the confirmed receipt.
      id: "submitted",
      label: "Transfer complete",
      narrative:
        "Reached only through the review: once the chain confirms the transfer, the receipt says it is complete, where the collectible went, and the hash.",
      prepare: prepareNft("submitted"),
      state: { chain: "preconfirmed", review: "passed", transactionHash: NFT_HASH },
    },
    {
      content: () => nftSendFlow(statusFor(), softwareAccount, preferences, nftId, [discoveredNft]),
      id: "failed",
      label: "Transfer failed",
      narrative:
        'A transfer the chain reverts ends on the failure, the chain\'s reason, and the hash — never on "Transfer complete".',
      prepare: prepareNft("failed"),
      state: { chain: "reverted", review: "passed", transactionHash: NFT_HASH },
    },
  ],
  description:
    "NFT metadata arrival, gallery and detail quality, guarded transfer review, blocking, submission, and a reverted transfer.",
  id: "nft",
  surface: "sidepanel",
  title: "NFT loading and send",
  views: ["nfts", "nft-watch", "nft-hidden", "nft-detail", "nft-send"],
};

export const walletScenarios: readonly WalletScenario[] = [
  onboardingScenario,
  unlockScenario,
  portfolioScenario,
  sendScenario,
  swapScenario,
  privacyScenario,
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
