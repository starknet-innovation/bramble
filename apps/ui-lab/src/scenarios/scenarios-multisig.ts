/**
 * Argent multisig lifecycle checkpoints. Route coverage is necessary but not
 * sufficient here: the frozen-intent review, threshold progress, stale
 * authority, deployment availability, and recovery states must be directly
 * inspectable before the shared-account experience can ship.
 */
import { isRecord } from "@mc-wallet/core/json";
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
  argentSoftwareAccount,
  argentStaleIntent,
  preferences,
  secondAccount,
  softwareAccount,
  statusFor,
} from "../fixtures/fixtures";
import { STRK_TOKEN } from "../fixtures/journey-fixtures";
import { type DashboardOptions, walletDashboard } from "../runtime/scenario-dashboard";
import { nextTurn } from "../runtime/scenario-runtime";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "../runtime/types";

const baseStatus = statusFor(softwareAccount);
const base: DashboardOptions = {
  multisigClassDeclared: true,
  multisigs: [argentMultisig],
  preferences: { ...preferences, tokens: [...preferences.tokens, STRK_TOKEN] },
  selectedMultisigId: argentMultisig.record.id,
  status: {
    ...baseStatus,
    accountCount: baseStatus.accounts.length + 1,
    accounts: [...baseStatus.accounts, argentSoftwareAccount],
  },
};

const bindFixtureMultisig = (
  context: FrameContext,
  feeAffordability: "insufficient" | "ok" = "ok",
): void => {
  const runtime = {
    sendMessage: async (message: unknown): Promise<unknown> => {
      if (
        isRecord(message) &&
        message["type"] === "wallet.reviewArgentMultisigDeployment" &&
        typeof message["networkId"] === "string" &&
        typeof message["salt"] === "string" &&
        typeof message["signerAccountId"] === "string" &&
        Array.isArray(message["signerPublicKeys"]) &&
        message["signerPublicKeys"].every((key) => typeof key === "string") &&
        Number.isSafeInteger(message["threshold"])
      ) {
        return {
          deploymentReview: {
            address: argentMultisig.record.address,
            fee: { overallFee: "252237000000000000", unit: "FRI" },
            feeAffordability,
            ...(typeof message["name"] === "string" && message["name"].length > 0
              ? { name: message["name"] }
              : {}),
            networkId: message["networkId"],
            salt: message["salt"],
            signerAccountId: message["signerAccountId"],
            signerPublicKeys: message["signerPublicKeys"],
            threshold: message["threshold"],
          },
          ok: true,
        };
      }
      if (isRecord(message) && message["type"] === "wallet.deployArgentMultisig") {
        const { deployment: _fixtureDeployment, ...record } = argentMultisig.record;
        return {
          address: argentMultisig.record.address,
          multisig: { ...argentMultisig, deployed: false, record },
          ok: true,
          transactionHash: "0x456",
        };
      }
      return { error: "UI Lab blocks non-fixture runtime requests" };
    },
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

const prepareDeploymentReview =
  (feeAffordability: "insufficient" | "ok") =>
  async (context: FrameContext): Promise<void> => {
    bindFixtureMultisig(context, feeAffordability);
    const form = context.app.querySelector<HTMLFormElement>("#multisig-deploy-form");
    if (!form) throw new Error("Missing production multisig deployment form");
    form.requestSubmit();
    await nextTurn();
  };

const prepareDeploymentApproval = async (context: FrameContext): Promise<void> => {
  bindFixtureMultisig(context);
  const continueButton = context.app.querySelector<HTMLButtonElement>(
    "[data-multisig-deploy-continue]",
  );
  if (!continueButton) throw new Error("Missing production multisig approval action");
  continueButton.click();
  await nextTurn();
};

const prepareDeploymentSubmitted = async (context: FrameContext): Promise<void> => {
  bindFixtureMultisig(context, "ok");
  const form = context.app.querySelector<HTMLFormElement>("#multisig-deploy-form");
  if (!form) throw new Error("Missing production multisig deployment form");
  form.requestSubmit();
  await nextTurn();
  form.requestSubmit();
  await nextTurn();
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

const prepareTransferComposer = async (context: FrameContext): Promise<void> => {
  bindFixtureMultisig(context);
  const picker = context.app.querySelector<HTMLDetailsElement>(".multisig-recipient-picker");
  if (!picker) throw new Error("Missing production multisig recipient picker");
  picker.open = true;
  const recipient = Array.from(
    context.app.querySelectorAll<HTMLButtonElement>("[data-ms-propose-recipient]"),
  ).find((button) => button.textContent?.includes("Research treasury"));
  recipient?.click();
  const amount = context.app.querySelector<HTMLInputElement>(
    '#multisig-propose-form input[name="amount"]',
  );
  if (!recipient || !amount) throw new Error("Missing production multisig transfer controls");
  amount.value = "25";
  amount.dispatchEvent(new Event("input", { bubbles: true }));
  amount.blur();
  await nextTurn();
};

const revealAdvancedCall = async (context: FrameContext): Promise<void> => {
  const details = context.app.querySelector<HTMLDetailsElement>(".multisig-advanced-call");
  if (!details) throw new Error("Missing production multisig advanced call disclosure");
  details.open = true;
  await nextTurn();
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
const { currentConfig: _incompleteCurrentConfig, ...incompleteSignerRecord } =
  argentMultisig.record;
const incompleteSignerConfig: ArgentMultisigView = {
  ...argentMultisig,
  record: incompleteSignerRecord,
};
const undeployedMultisig: ArgentMultisigView = {
  ...argentMultisig,
  config: null,
  deployed: false,
};
const {
  currentConfig: _currentConfig,
  deployment: _deployment,
  ...watchedUndeployedRecord
} = argentMultisig.record;
const watchedUndeployedMultisig: ArgentMultisigView = {
  config: null,
  deployed: false,
  record: watchedUndeployedRecord,
};
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
    "Add shared address",
    "One address syncs a deployed account or becomes a verified deployment handoff when it is still counterfactual.",
    { selectedMultisigId: null, view: "multisig-watch" },
    { input: "address only", verification: "chain or deployment review" },
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
      "Choose deployment signers",
      "The account name and signer identities are resolved before approval and deployment choices appear.",
      { selectedMultisigId: null, view: "multisig-deploy" },
      { class: "declared", step: "signers" },
    ),
    prepare: bindFixtureMultisig,
  },
  {
    ...checkpoint(
      "deploy-approval",
      "Set approval policy",
      "Threshold, deployment signer, and advanced salt form one focused decision after the signer set is complete.",
      { selectedMultisigId: null, view: "multisig-deploy" },
      { class: "declared", step: "approval", threshold: 2 },
    ),
    prepare: prepareDeploymentApproval,
  },
  {
    ...checkpoint(
      "deploy-reviewed",
      "Reviewed deployment",
      "The predicted address, irreversible authority, fee ceiling, and exact constructor fit the extension surface before confirmation.",
      { selectedMultisigId: null, view: "multisig-deploy" },
      { class: "declared", funding: "ready", threshold: 2 },
    ),
    prepare: prepareDeploymentReview("ok"),
  },
  {
    ...checkpoint(
      "deploy-funding",
      "Funding required",
      "An unfunded counterfactual address is caught before broadcast and names the recovery action.",
      { selectedMultisigId: null, view: "multisig-deploy" },
      { class: "declared", funding: "required", threshold: 2 },
    ),
    prepare: prepareDeploymentReview("insufficient"),
  },
  {
    ...checkpoint(
      "deploy-submitted",
      "Deployment submitted",
      "The transaction hash and account stay visible after broadcast while Starknet confirms deployment.",
      { selectedMultisigId: null, view: "multisig-deploy" },
      { deployment: "submitted", outcome: "pending" },
    ),
    prepare: prepareDeploymentSubmitted,
  },
  checkpoint(
    "home-deployment-required",
    "Deployment required",
    "A shared counterfactual address can be watched before deployment and replaces the dead Prepare action with the exact recovery step.",
    { multisigs: [watchedUndeployedMultisig], view: "multisig-home" },
    { action: "complete setup", deployed: false },
  ),
  {
    ...checkpoint(
      "deploy-recover",
      "Deploy watched address",
      "The wallet collects the missing constructor and binds fee review to the watched address so an incorrect signer set, threshold, or salt cannot deploy a different account.",
      { multisigs: [watchedUndeployedMultisig], view: "multisig-deploy" },
      { constructor: "address-bound", deployed: false },
    ),
    prepare: bindFixtureMultisig,
  },
  checkpoint(
    "deploy-resume",
    "Resume saved deployment",
    "The wallet restores the original signer set, threshold, salt, and eligible deployment signer instead of making the user reconstruct them.",
    { multisigs: [undeployedMultisig], view: "multisig-deploy" },
    { constructor: "restored", deployed: false },
  ),
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
    "Recognizable signer identities and guided authority changes replace raw contract-call composition.",
    { view: "multisig-signers" },
    { actions: ["add", "replace", "remove", "threshold"], threshold: 2 },
  ),
  {
    ...checkpoint(
      "signers-incomplete",
      "Signer recovery fallback",
      "Address-only join normally syncs signer keys from chain history; this fallback asks only for keys the RPC could not recover.",
      {
        multisigs: [incompleteSignerConfig],
        status: softwareSignerOnly,
        view: "multisig-signers",
      },
      { recovery: "missing Stark public keys", threshold: 2 },
    ),
    prepare: bindFixtureMultisig,
  },
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
  {
    ...checkpoint(
      "propose",
      "Compose token transfer",
      "The common path uses saved recipients, tracked assets, token logos, balances, and human amounts before review.",
      { view: "multisig-propose" },
      { task: "compose token transfer" },
    ),
    prepare: prepareTransferComposer,
  },
  {
    ...checkpoint(
      "propose-advanced",
      "Advanced contract call",
      "Exact target, entrypoint, and calldata remain available without dominating the common transfer journey.",
      { view: "multisig-propose" },
      { disclosure: "advanced", task: "compose contract call" },
    ),
    prepare: revealAdvancedCall,
  },
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
