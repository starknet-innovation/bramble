import type { Meta, StoryObj } from "@storybook/html-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { WALLET_VIEWS } from "../../../src/sidepanel/views";
import { createUiLab } from "./lab-runtime";
import { walletScenarios } from "./scenarios";

type LabArgs = {
  readonly checkpointId: string;
  readonly scenarioId: string;
};

const meta: Meta<LabArgs> = {
  args: {
    checkpointId: "details",
    scenarioId: "send",
  },
  parameters: {
    chromatic: {
      pauseAnimationAtEnd: true,
    },
    docs: {
      description: {
        component:
          "A fixture-only review bench that renders MC Wallet production HTML, CSS, bindings, and motion. Use Canvas for live motion and the Interactions panel for scripted flow steps; use Chromatic snapshots and comments for durable PR review.",
      },
    },
  },
  render: (args) =>
    createUiLab({
      checkpointId: args.checkpointId,
      scenarioId: args.scenarioId,
    }),
  tags: ["autodocs"],
  title: "Wallet UI Lab/Scenarios",
};

export default meta;
type Story = StoryObj<LabArgs>;

const assertCheckpointReady = async (canvasElement: HTMLElement): Promise<void> => {
  await waitFor(() => {
    const lab = canvasElement.firstElementChild;
    expect(lab).toHaveAttribute("data-lab-ready", "true");
  });
  const error = canvasElement.querySelector("[data-lab-error]");
  expect(error).not.toBeVisible();
  const frame = canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]");
  expect(frame?.contentDocument?.querySelector(".shell")).toBeInTheDocument();
};

const checkpointStory = (name: string, scenarioId: string, checkpointId: string): Story => ({
  args: { checkpointId, scenarioId },
  name,
  play: async ({ canvasElement }) => assertCheckpointReady(canvasElement),
});

export const OnboardingWelcome = checkpointStory(
  "Onboarding · choose setup",
  "onboarding",
  "welcome",
);
export const OnboardingPhraseMasked = checkpointStory(
  "Onboarding · generated phrase",
  "onboarding",
  "generated-masked",
);
export const OnboardingBackupConfirmed = checkpointStory(
  "Onboarding · backup confirmed",
  "onboarding",
  "backup-confirmed",
);
export const OnboardingImport = checkpointStory(
  "Onboarding · import existing",
  "onboarding",
  "import-existing",
);
export const UnlockWithRequest = checkpointStory(
  "Onboarding · request waiting",
  "onboarding",
  "locked-request",
);
export const UnlockFailure = checkpointStory(
  "Onboarding · unlock failed",
  "onboarding",
  "unlock-failed",
);

export const PortfolioReady = checkpointStory("Portfolio · ready", "portfolio", "ready");
export const PortfolioCollectibles = checkpointStory(
  "Portfolio · collectibles",
  "portfolio",
  "collectibles",
);
export const PortfolioAccountDrawer = checkpointStory(
  "Portfolio · account drawer",
  "portfolio",
  "account-drawer",
);
export const PortfolioUndeployed = checkpointStory(
  "Portfolio · undeployed account",
  "portfolio",
  "undeployed",
);
export const PortfolioPricesOffline = checkpointStory(
  "Portfolio · prices offline",
  "portfolio",
  "prices-offline",
);
export const PortfolioBalanceFailure = checkpointStory(
  "Portfolio · balance failure",
  "portfolio",
  "balance-error",
);
export const PortfolioEmptyNetwork = checkpointStory(
  "Portfolio · empty network",
  "portfolio",
  "empty-network",
);

export const SendDetails = checkpointStory("Send · details", "send", "details");
export const SendReview = checkpointStory("Send · review", "send", "review");
export const SendFeeFailure = checkpointStory("Send · fee failure", "send", "fee-failure");
export const SendLedgerAuthorization = checkpointStory(
  "Send · Ledger authorization",
  "send",
  "authorizing",
);
export const SendBroadcast = checkpointStory("Send · broadcast", "send", "broadcasting");
export const SendSuccess = checkpointStory("Send · success", "send", "submitted");

export const SwapEdit = checkpointStory("Swap · edit", "swap", "edit");
export const SwapPicker = checkpointStory("Swap · token picker", "swap", "picker");
export const SwapLoading = checkpointStory("Swap · finding route", "swap", "loading");
export const SwapQuote = checkpointStory("Swap · quote", "swap", "quote");
export const SwapHighRisk = checkpointStory("Swap · high-loss route", "swap", "high-risk");
export const SwapQuoteFailure = checkpointStory("Swap · no route", "swap", "quote-failed");
export const SwapReview = checkpointStory("Swap · frozen review", "swap", "review");
export const SwapExecutionFailure = checkpointStory(
  "Swap · execution failed",
  "swap",
  "execute-failed",
);
export const SwapSubmitted = checkpointStory("Swap · submitted", "swap", "submitted");

export const LedgerConnect = checkpointStory("Ledger · connect", "ledger", "connect");
export const LedgerDeviceChoice = checkpointStory("Ledger · device choice", "ledger", "devices");
export const LedgerApprove = checkpointStory("Ledger · approve", "ledger", "confirming");
export const LedgerFailure = checkpointStory("Ledger · failure", "ledger", "error");

export const LedgerOnboardingMethod = checkpointStory(
  "Ledger onboarding · method",
  "ledger-onboarding",
  "method",
);
export const LedgerOnboardingDevices = checkpointStory(
  "Ledger onboarding · devices",
  "ledger-onboarding",
  "devices",
);
export const LedgerOnboardingAccounts = checkpointStory(
  "Ledger onboarding · accounts",
  "ledger-onboarding",
  "accounts",
);
export const LedgerOnboardingPartialAdd = checkpointStory(
  "Ledger onboarding · partial add",
  "ledger-onboarding",
  "partial-add",
);

export const ApprovalConnect = checkpointStory("Approvals · connect", "approvals", "connect");
export const ApprovalInvoke = checkpointStory("Approvals · transaction", "approvals", "invoke");
export const ApprovalTypedData = checkpointStory(
  "Approvals · typed data",
  "approvals",
  "typed-data",
);
export const ApprovalPrivate = checkpointStory(
  "Approvals · private transaction",
  "approvals",
  "private-invoke",
);
export const ApprovalWatchAsset = checkpointStory(
  "Approvals · watch asset",
  "approvals",
  "watch-asset",
);
export const ApprovalSwitchChain = checkpointStory(
  "Approvals · switch chain",
  "approvals",
  "switch-chain",
);
export const ApprovalAddChain = checkpointStory("Approvals · add chain", "approvals", "add-chain");
export const ApprovalDeclare = checkpointStory("Approvals · declare", "approvals", "declare");
export const ApprovalBlocked = checkpointStory(
  "Approvals · blocked origin",
  "approvals",
  "blocked-origin",
);
export const ApprovalQueue = checkpointStory("Approvals · queue", "approvals", "queue");

export const DappTakeover = checkpointStory("dApp · takeover", "dapp", "takeover");
export const DappWatchAsset = checkpointStory("dApp · receipt token", "dapp", "watch-asset");
export const DappSnoozed = checkpointStory("dApp · review later", "dapp", "snoozed");

export const ActivityAccountA = checkpointStory("Activity · account A", "activity", "account-a");
export const ActivityScopeCleared = checkpointStory(
  "Activity · switch boundary",
  "activity",
  "scope-cleared",
);
export const ActivityAccountB = checkpointStory("Activity · account B", "activity", "account-b");

export const AssetsReceive = checkpointStory("Assets · receive", "assets", "receive");
export const AssetsTokens = checkpointStory("Assets · tokens", "assets", "tokens");
export const AssetsTokenDetail = checkpointStory("Assets · token detail", "assets", "token-detail");
export const AssetsTokenOffline = checkpointStory(
  "Assets · token offline",
  "assets",
  "token-offline",
);
export const AssetsAddressBook = checkpointStory("Assets · address book", "assets", "address-book");
export const AssetsAllowances = checkpointStory("Assets · allowances", "assets", "allowances");

export const NftMetadataLoading = checkpointStory(
  "NFT · metadata loading",
  "nft",
  "metadata-loading",
);
export const NftGallery = checkpointStory("NFT · gallery", "nft", "gallery");
export const NftDetail = checkpointStory("NFT · detail", "nft", "detail");
export const NftTransferReview = checkpointStory("NFT · transfer review", "nft", "review");
export const NftRecipientBlocked = checkpointStory("NFT · blocked recipient", "nft", "blocked");
export const NftTransferSubmitted = checkpointStory("NFT · submitted", "nft", "submitted");

export const MultisigProposal = checkpointStory("Multisig · proposal", "multisig", "proposal");
export const MultisigReady = checkpointStory("Multisig · ready to execute", "multisig", "ready");
export const MultisigSyncFailure = checkpointStory(
  "Multisig · refresh failed",
  "multisig",
  "sync-error",
);
export const MultisigPropose = checkpointStory("Multisig · propose", "multisig", "propose");
export const MultisigDeployChecking = checkpointStory(
  "Multisig · deploy checking",
  "multisig",
  "deploy-checking",
);
export const MultisigDeployDeclare = checkpointStory(
  "Multisig · declare first",
  "multisig",
  "deploy-declare",
);
export const MultisigDeployReady = checkpointStory(
  "Multisig · deploy ready",
  "multisig",
  "deploy-ready",
);
export const MultisigUntracked = checkpointStory(
  "Multisig · untracked proposal",
  "multisig",
  "shared-untracked",
);
export const MultisigExecuted = checkpointStory("Multisig · executed", "multisig", "executed");

export const SettingsHub = checkpointStory("Settings · hub", "settings-security", "hub");
export const SettingsNetwork = checkpointStory(
  "Settings · network",
  "settings-security",
  "network",
);
export const SettingsAdvancedEndpoints = checkpointStory(
  "Settings · advanced endpoints",
  "settings-security",
  "advanced-endpoints",
);
export const SettingsAccounts = checkpointStory(
  "Settings · accounts and groups",
  "settings-security",
  "accounts",
);
export const SettingsClassMismatch = checkpointStory(
  "Settings · class mismatch",
  "settings-security",
  "class-mismatch",
);
export const SettingsConnectedSites = checkpointStory(
  "Settings · connected sites",
  "settings-security",
  "connected-sites",
);
export const SettingsBackup = checkpointStory(
  "Settings · mixed-wallet backup",
  "settings-security",
  "backup",
);
export const SettingsRevealSoftware = checkpointStory(
  "Settings · reveal software",
  "settings-security",
  "reveal-software",
);
export const SettingsRevealImported = checkpointStory(
  "Settings · reveal imported",
  "settings-security",
  "reveal-imported",
);
export const SettingsRevealLedger = checkpointStory(
  "Settings · reveal Ledger",
  "settings-security",
  "reveal-ledger",
);

export const ProductionViewCoverage: Story = {
  args: { checkpointId: "ready", scenarioId: "portfolio" },
  name: "Contract · every wallet view covered",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const covered = new Set(walletScenarios.flatMap((scenario) => scenario.views ?? []));
    expect(WALLET_VIEWS.filter((view) => !covered.has(view))).toEqual([]);
    expect(new Set(walletScenarios.map((scenario) => scenario.id)).size).toBe(
      walletScenarios.length,
    );
    for (const scenario of walletScenarios) {
      expect(new Set(scenario.checkpoints.map((checkpoint) => checkpoint.id)).size).toBe(
        scenario.checkpoints.length,
      );
    }
  },
};

export const GuidedInteractionWalkthrough: Story = {
  args: { checkpointId: "details", scenarioId: "send" },
  name: "Interaction · step through Send",
  play: async ({ canvasElement, step }) => {
    await assertCheckpointReady(canvasElement);
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { level: 2, name: "Details" })).toBeVisible();
    await step("Advance into deterministic review latency", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Step" }));
      await assertCheckpointReady(canvasElement);
      await expect(
        await canvas.findByRole("heading", { level: 2, name: "Preparing review" }),
      ).toBeVisible();
    });
    await step("Advance into the decoded review", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Step" }));
      await assertCheckpointReady(canvasElement);
      await expect(
        await canvas.findByRole("heading", { level: 2, name: "Review ready" }),
      ).toBeVisible();
    });
  },
};
