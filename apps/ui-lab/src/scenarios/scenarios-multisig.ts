/**
 * Argent multisig lifecycle checkpoints. Route coverage is necessary but not
 * sufficient here: the frozen-intent review, threshold progress, stale
 * authority, deployment availability, and recovery states must be directly
 * inspectable before the shared-account experience can ship.
 */
import {
  type ArgentMultisigView,
  bindMultisigs,
  createMultisigClient,
  createSidepanelRuntime,
} from "@mc-wallet/wallet-ui/lab";
import {
  argentCollectingIntent,
  argentMultisig,
  argentReadyIntent,
  argentStaleIntent,
  secondAccount,
  softwareAccount,
  statusFor,
} from "../fixtures/fixtures";
import { type DashboardOptions, walletDashboard } from "../runtime/scenario-dashboard";
import { nextTurn } from "../runtime/scenario-runtime";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "../runtime/types";

const base: DashboardOptions = {
  multisigClassDeclared: true,
  multisigs: [argentMultisig],
  selectedMultisigId: argentMultisig.record.id,
};

const bindFixtureMultisig = (context: FrameContext): void => {
  const runtime = {
    sendMessage: async (): Promise<unknown> => ({
      error: "UI Lab blocks non-fixture runtime requests",
    }),
  };
  bindMultisigs({
    app: context.app,
    multisig: createMultisigClient(runtime),
    openDetail: () => undefined,
    openList: () => undefined,
    render: async () => undefined,
    selectedMultisigId: () => argentMultisig.record.id,
    wallet: createSidepanelRuntime(runtime),
  });
};

const revealIntentPanel = async (context: FrameContext): Promise<void> => {
  bindFixtureMultisig(context);
  const tab = context.app.querySelector<HTMLButtonElement>('[data-ms-home-tab="intents"]');
  if (tab) {
    tab.click();
    await nextTurn();
  } else if (!context.app.querySelector("[data-ms-intent]")) {
    throw new Error("Missing production multisig intent review");
  }
};

const checkpoint = (
  id: string,
  label: string,
  narrative: string,
  options: DashboardOptions,
  state: Readonly<Record<string, unknown>>,
  showIntents = false,
): ScenarioCheckpoint => ({
  content: () => walletDashboard({ ...base, ...options }),
  id,
  label,
  narrative,
  ...(showIntents ? { prepare: revealIntentPanel } : {}),
  state,
});

const unavailableAuthority: ArgentMultisigView = { ...argentMultisig, config: null };
const changedAuthority: ArgentMultisigView = {
  ...argentMultisig,
  config: {
    ...(argentMultisig.config ?? {
      classHash: argentMultisig.record.classHash,
      signerGuids: [],
      threshold: 2,
    }),
    signerGuids: [...(argentMultisig.config?.signerGuids ?? []), "0x999"],
  },
};
const softwareSignature = argentReadyIntent.signatures.find(
  (signature) => signature.publicKey === softwareAccount.publicKeyX,
);
if (!softwareSignature) {
  throw new Error("UI Lab multisig fixture is missing the software signer signature");
}
const locallySignedIntent = {
  ...argentCollectingIntent,
  signatures: [softwareSignature],
};
const softwareSignerOnly = {
  ...statusFor(softwareAccount),
  accountCount: 1,
  accounts: [softwareAccount],
};
const observerOnly = {
  ...statusFor(secondAccount),
  accountCount: 1,
  accounts: [secondAccount],
};

const checkpoints: readonly ScenarioCheckpoint[] = [
  checkpoint(
    "empty",
    "No shared accounts",
    "The first-run state explains the two deliberate paths: deploy a new account or watch an existing address.",
    { multisigs: [], selectedMultisigId: null, view: "multisigs" },
    { accounts: 0, task: "choose setup path" },
  ),
  checkpoint(
    "list",
    "Shared account list",
    "Quorum and open work are visible before the user changes portfolio identity.",
    { multisigIntents: [argentCollectingIntent], selectedMultisigId: null, view: "multisigs" },
    { openIntents: 1, quorum: "2 of 2" },
  ),
  checkpoint(
    "add",
    "Choose setup path",
    "Creating and watching are separate tasks with explicit trust consequences.",
    { selectedMultisigId: null, view: "multisig-add" },
    { choices: ["deploy", "watch"] },
  ),
  checkpoint(
    "watch",
    "Watch existing account",
    "The wallet verifies the current signer authority for the entered account before it becomes actionable.",
    { selectedMultisigId: null, view: "multisig-watch" },
    { verification: "required" },
  ),
  checkpoint(
    "deploy-class-check",
    "Deployment unavailable",
    "A missing pinned class fails closed and explains the network prerequisite instead of rendering a dead form.",
    { multisigClassDeclared: false, selectedMultisigId: null, view: "multisig-deploy" },
    { class: "not declared" },
  ),
  {
    ...checkpoint(
      "deploy-ready",
      "Review deployment inputs",
      "Constructor authority, threshold, signer, class, network, and salt are composed as one reviewable deployment task.",
      { selectedMultisigId: null, view: "multisig-deploy" },
      { class: "declared", threshold: 2 },
    ),
    prepare: bindFixtureMultisig,
  },
  checkpoint(
    "home",
    "Shared portfolio",
    "A shared account behaves like a selected portfolio while keeping quorum context and shared actions explicit.",
    { multisigIntents: [argentCollectingIntent], view: "multisig-home" },
    { openIntents: 1, view: "portfolio" },
  ),
  checkpoint(
    "home-empty",
    "Shared portfolio without work",
    "The empty proposal lane offers a clear next action without weakening the shared-account identity.",
    { multisigIntents: [], view: "multisig-home" },
    { openIntents: 0 },
    true,
  ),
  checkpoint(
    "home-intents",
    "Condensed open work",
    "Home keeps each intent to one scannable line before opening the focused review.",
    { multisigIntents: [argentReadyIntent], view: "multisig-home" },
    { openIntents: 1, view: "condensed" },
    true,
  ),
  checkpoint(
    "intent-collecting",
    "Collect signatures",
    "Human outcome and risk lead; fee ceiling, threshold progress, and exact identity remain verifiable.",
    { multisigIntents: [argentCollectingIntent], view: "multisig-detail" },
    { signatures: 0, state: "collecting", threshold: 2 },
    true,
  ),
  checkpoint(
    "intent-ready",
    "Ready to submit",
    "Submission appears only after the verified threshold is complete and fresh authority still matches.",
    { multisigIntents: [argentReadyIntent], view: "multisig-detail" },
    { signatures: 2, state: "ready", threshold: 2 },
    true,
  ),
  checkpoint(
    "intent-signed-local",
    "Local signer complete",
    "After this wallet signs, sharing becomes the next action and signing is not offered twice.",
    {
      multisigIntents: [locallySignedIntent],
      status: softwareSignerOnly,
      view: "multisig-detail",
    },
    { localSigner: "signed", signatures: 1, state: "collecting", threshold: 2 },
    true,
  ),
  checkpoint(
    "intent-no-local-signer",
    "No eligible local signer",
    "A watch-only participant is directed to share the package without seeing an unusable signer action.",
    {
      multisigIntents: [argentCollectingIntent],
      status: observerOnly,
      view: "multisig-detail",
    },
    { localSigner: "unavailable", signatures: 0, state: "collecting", threshold: 2 },
    true,
  ),
  checkpoint(
    "intent-stale",
    "Stale transaction",
    "A stale frozen intent remains inspectable but cannot masquerade as executable work.",
    { multisigIntents: [argentStaleIntent], view: "multisig-detail" },
    { state: "stale" },
    true,
  ),
  checkpoint(
    "authority-unavailable",
    "Authority unavailable",
    "Missing fresh signer authority disables proposal preparation and signature collection.",
    { multisigs: [unavailableAuthority], view: "multisig-detail" },
    { authority: "unavailable", failClosed: true },
  ),
  checkpoint(
    "authority-changed",
    "Authority changed",
    "A changed signer set is shown as a blocking mismatch against the frozen snapshot.",
    {
      multisigIntents: [argentReadyIntent],
      multisigs: [changedAuthority],
      view: "multisig-detail",
    },
    { authority: "mismatch", failClosed: true },
    true,
  ),
  checkpoint(
    "signers",
    "Current signer authority",
    "The live signer GUIDs and threshold are readable before any new intent is prepared.",
    { view: "multisig-signers" },
    { threshold: 2 },
  ),
  checkpoint(
    "track",
    "Import signing intent",
    "An external intent package enters through an explicit verification task, not a generic paste surface.",
    { view: "multisig-track" },
    { task: "verify intent package" },
  ),
  checkpoint(
    "receive",
    "Receive into multisig",
    "The exact shared address and network remain visually bound to the selected identity.",
    { view: "multisig-receive" },
    { task: "receive" },
  ),
  checkpoint(
    "propose",
    "Prepare exact transaction",
    "The composer states that one immutable V3 transaction will be frozen for every signer to verify.",
    { view: "multisig-propose" },
    { task: "prepare frozen intent" },
  ),
  checkpoint(
    "sync-error",
    "Shared-account sync failure",
    "Previously known identity stays visible while current authority and work are marked unavailable.",
    { multisigsError: true, selectedMultisigId: null, view: "multisigs" },
    { recovery: "retry", sync: "failed" },
  ),
];

export const multisigScenario: WalletScenario = {
  checkpoints,
  description:
    "Argent deployment, watched identity, portfolio, exact-intent review, signature threshold, authority drift, and recovery.",
  id: "multisig",
  surface: "sidepanel",
  title: "Argent multisig",
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
