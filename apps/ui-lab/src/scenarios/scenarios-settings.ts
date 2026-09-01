import { showToast } from "@bramble/wallet-ui/lab";
import { ledgerAccount, softwareAccount, statusFor } from "../fixtures/fixtures";
import { connectedSites, importedStatus, journeyPreferences } from "../fixtures/journey-fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import type { FrameContext, WalletScenario } from "../runtime/types";

const openAdvancedEndpoint = (context: FrameContext): void => {
  const disclosure = context.app.querySelector<HTMLDetailsElement>('[data-disclosure="rpc"]');
  if (!disclosure) {
    throw new Error("Missing production RPC disclosure");
  }
  disclosure.open = true;
};

const openCoordinationRelay = (context: FrameContext): void => {
  const disclosure = context.app.querySelector<HTMLDetailsElement>(
    '[data-disclosure="nostr-relay"]',
  );
  if (!disclosure) {
    throw new Error("Missing production Nostr relay disclosure");
  }
  disclosure.open = true;
};

const openExplorerData = (context: FrameContext): void => {
  const disclosure = context.app.querySelector<HTMLDetailsElement>(
    '[data-disclosure="explorer-fallback"]',
  );
  if (!disclosure) throw new Error("Missing production explorer disclosure");
  disclosure.open = true;
};

const showRejectedService = (context: FrameContext): void => {
  openExplorerData(context);
  showToast(
    'RPC: starknet_addInvokeTransaction with params {"invoke_transaction":{"calldata":["0x1"]}} 55: Account validation failed: upstream gateway rejected the request',
    "error",
    context.app,
  );
};

export const settingsScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "settings" }),
      id: "hub",
      label: "Settings hub",
      narrative:
        "Wallet, experience, and security destinations are grouped by intent without inline controls.",
      state: { requestSurface: "side-panel", theme: "dark" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "appearance" }),
      id: "appearance",
      label: "Appearance & currency",
      narrative: "Theme and valuation preferences share one low-risk display task.",
      state: { currency: "USD", theme: "dark" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "request-settings" }),
      id: "request-settings",
      label: "Wallet request behavior",
      narrative: "Request routing explains takeover behavior beside the one preference it changes.",
      state: { requestSurface: "side-panel" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "security" }),
      id: "security",
      label: "Security & permissions",
      narrative: "External access and recovery destinations are separated before any action.",
      state: { groups: ["external access", "recovery"] },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "network" }),
      id: "network",
      label: "Choose network",
      narrative:
        "Network selection leads while custom infrastructure remains one deliberate level deeper.",
      state: { networks: 2, rpc: "custom" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "advanced-network" }),
      id: "advanced-endpoints",
      label: "Advanced endpoints",
      narrative:
        "RPC, privacy, Nostr, NFT, and local diagnostics controls keep their trust context behind concise disclosures.",
      prepare: openAdvancedEndpoint,
      state: { disclosure: "rpc", state: "open" },
    },
    {
      content: () =>
        walletDashboard({
          preferences: {
            ...journeyPreferences,
            explorerApiUrls: { SN_MAIN: "https://explorer.team.example/v1" },
            explorerFallback: { SN_MAIN: true },
          },
          view: "advanced-network",
        }),
      id: "explorer-data",
      label: "Explorer data and rejected request",
      narrative:
        "Explorer routing and disclosure consent stay together; a rejected request keeps one human line while its copy control retains the complete diagnostic.",
      prepare: showRejectedService,
      state: { disclosure: "explorer-fallback", endpoint: "custom", toast: "copyable" },
    },
    {
      content: () =>
        walletDashboard({
          preferences: {
            ...journeyPreferences,
            nostrRelayUrl: "wss://relay.team.example/multisig",
          },
          view: "advanced-network",
        }),
      id: "nostr-relay",
      label: "Multisig coordination relay",
      narrative:
        "A custom relay is an explicit replacement for the reviewed defaults and stays beside its privacy context.",
      prepare: openCoordinationRelay,
      state: { disclosure: "nostr-relay", state: "custom" },
    },
    {
      content: () =>
        walletDashboard({
          classHashVerification: {
            onChainClassHash: softwareAccount.classHash,
            status: "verified",
          },
          expandedGroupId: "operations",
          preferences: journeyPreferences,
          view: "account",
        }),
      id: "accounts",
      label: "Accounts and groups",
      narrative:
        "Switching, folders, naming, and on-chain identity stay together; account creation branches from one chooser.",
      state: { classHash: "verified", group: "operations" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "import-key" }),
      id: "import-key",
      label: "Import private key",
      narrative:
        "Raw-key import is isolated from routine account management and names its control boundary.",
      state: { vault: "encrypted", view: "import-key" },
    },
    {
      content: () =>
        walletDashboard({
          classHashVerification: {
            expectedClassHash: softwareAccount.classHash,
            onChainClassHash: "0x999",
            status: "mismatch",
          },
          preferences: journeyPreferences,
          view: "account",
        }),
      id: "class-mismatch",
      label: "Account class mismatch",
      narrative:
        "A contract identity mismatch is assertive and never presented as a benign loading error.",
      state: { classHash: "mismatch", trust: "blocked" },
    },
    {
      content: () =>
        walletDashboard({
          connectedSites,
          preferences: journeyPreferences,
          view: "connected-sites",
        }),
      id: "connected-sites",
      label: "Connected sites",
      narrative: "Every active origin shows its granted account count and direct revocation.",
      state: { origins: 2 },
    },
    {
      content: () =>
        walletDashboard({
          connectedSites: [],
          preferences: journeyPreferences,
          view: "connected-sites",
        }),
      id: "connected-empty",
      label: "No connected sites",
      narrative: "The empty state explains exactly how a site will appear here.",
      state: { origins: 0 },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "backup" }),
      id: "backup",
      label: "Mixed-wallet backup",
      narrative: "The user chooses export or restore before either task reveals controls.",
      state: { includesLedger: true, secretsExported: false },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "backup-export" }),
      id: "backup-export",
      label: "Download backup",
      narrative: "The export screen states its non-secret scope before creating a file.",
      state: { secretsExported: false, task: "export" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "backup-restore" }),
      id: "backup-restore",
      label: "Restore backup",
      narrative: "Preference replacement has an isolated warning and file control.",
      state: { accountsChanged: false, task: "restore" },
    },
    {
      content: () => walletDashboard({ preferences: journeyPreferences, view: "reveal" }),
      id: "reveal-software",
      label: "Software recovery",
      narrative: "Software secrets require fresh passphrase authentication and remain masked.",
      state: { accountKind: "software", reauthentication: true },
    },
    {
      content: () =>
        walletDashboard({
          preferences: {
            ...journeyPreferences,
            accountLabels: {
              ...journeyPreferences.accountLabels,
              [importedStatus.activeAccountId ?? ""]: "Imported signer",
            },
          },
          status: importedStatus,
          view: "reveal",
        }),
      id: "reveal-imported",
      label: "Imported-key recovery",
      narrative:
        "The wallet warns that its recovery phrase cannot restore a standalone imported key.",
      state: { accountKind: "imported", recoveryBoundary: "separate key" },
    },
    {
      content: () =>
        walletDashboard({
          preferences: journeyPreferences,
          status: statusFor(ledgerAccount),
          view: "reveal",
        }),
      id: "reveal-ledger",
      label: "Ledger recovery",
      narrative: "Hardware accounts never fabricate a wallet phrase or private-key reveal path.",
      state: { accountKind: "ledger", keysLeaveDevice: false },
    },
  ],
  description:
    "Settings, networks, accounts/groups, connected origins, backup, and recovery boundaries.",
  id: "settings-security",
  surface: "sidepanel",
  title: "Settings and security",
  views: [
    "settings",
    "appearance",
    "request-settings",
    "security",
    "network",
    "advanced-network",
    "account",
    "import-key",
    "backup",
    "backup-export",
    "backup-restore",
    "connected-sites",
    "reveal",
  ],
};
