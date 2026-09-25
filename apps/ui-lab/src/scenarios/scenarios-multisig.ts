/**
 * Argent multisig lifecycle checkpoints. Route coverage is necessary but not
 * sufficient here: the frozen-intent review, threshold progress, stale
 * authority, deployment availability, and recovery states must be directly
 * inspectable before the shared-account experience can ship.
 */
import { isRecord } from "@bramble/core/json";
import {
  type ArgentMultisigView,
  bindMultisigs,
  createMultisigClient,
  createSidepanelRuntime,
} from "@bramble/wallet-ui/lab";
import {
  argentCollectingIntent,
  argentMultisig,
  argentReadyIntent,
  argentReplacementIntent,
  argentSoftwareAccount,
  argentStaleIntent,
  argentSubmittedIntent,
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
      if (isRecord(message) && message["type"] === "wallet.removeArgentMultisigIntent") {
        return { ok: true };
      }
      if (
        isRecord(message) &&
        message["type"] === "wallet.resolveMultisigSigner" &&
        typeof message["address"] === "string"
      ) {
        return {
          ok: true,
          signer: {
            accountContractType: "openzeppelin",
            address: message["address"],
            publicKeyX: "0x789",
          },
        };
      }
      return { error: "UI Lab blocks non-fixture runtime requests" };
    },
  };
  bindMultisigs({
    app: context.app,
    multisig: createMultisigClient(runtime),
    openDetail: () => undefined,
    openIntent: () => undefined,
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

const revealDeploymentParticipant = async (context: FrameContext): Promise<void> => {
  bindFixtureMultisig(context);
  const open = context.app.querySelector<HTMLButtonElement>("[data-open-participant-picker]");
  if (!open) throw new Error("Missing production participant picker action");
  open.click();
  await nextTurn();
};

const revealDeploymentWalletCard = async (context: FrameContext): Promise<void> => {
  await revealDeploymentParticipant(context);
  const method = context.app.querySelector<HTMLButtonElement>(
    '[data-participant-method="wallet-card"]',
  );
  if (!method) throw new Error("Missing production wallet-card participant method");
  method.click();
  await nextTurn();
};

const revealManagementParticipant = async (context: FrameContext): Promise<void> => {
  bindFixtureMultisig(context);
  const add = [...context.app.querySelectorAll<HTMLDetailsElement>("details.disclosure")].find(
    (details) => details.textContent?.includes("Add participant"),
  );
  if (!add) throw new Error("Missing production signer-management participant action");
  add.open = true;
  add.querySelector<HTMLButtonElement>("[data-open-participant-picker]")?.click();
  context.app.querySelector<HTMLButtonElement>('[data-participant-method="public-key"]')?.click();
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

const revealCollaboration = async (context: FrameContext): Promise<void> => {
  await revealIntentPanel(context);
  const collaboration = context.app.querySelector<HTMLDetailsElement>(".multisig-collaboration");
  if (!collaboration) throw new Error("Missing production co-signer handoff");
  collaboration.open = true;
  await nextTurn();
};

const revealIntentTechnical = async (context: FrameContext): Promise<void> => {
  await revealIntentPanel(context);
  const technical = context.app.querySelector<HTMLDetailsElement>(".decision-technical");
  if (!technical) throw new Error("Missing production intent inspection");
  technical.open = true;
  await nextTurn();
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

const unavailableAuthority: ArgentMultisigView = {
  ...argentMultisig,
  authorityStatus: "network-unavailable",
  config: null,
  deployed: null,
};
const { currentConfig: _incompleteCurrentConfig, ...incompleteSignerRecord } =
  argentMultisig.record;
const incompleteSignerConfig: ArgentMultisigView = {
  ...argentMultisig,
  record: incompleteSignerRecord,
};
const unsupportedSignerAuthority: ArgentMultisigView = {
  ...argentMultisig,
  authorityStatus: "unsupported-signers",
  config: {
    classHash: argentMultisig.record.classHash,
    signerGuids: ["0x123"],
    threshold: 1,
  },
  record: incompleteSignerRecord,
  unsupportedSigners: [{ guid: "0x123", type: "webauthn" }],
};
const undeployedMultisig: ArgentMultisigView = {
  ...argentMultisig,
  authorityStatus: "undeployed",
  config: null,
  deployed: false,
};
const { currentConfig: _pendingConfig, ...pendingDeploymentRecord } = argentMultisig.record;
const pendingDeploymentMultisig: ArgentMultisigView = {
  ...argentMultisig,
  authorityStatus: "undeployed",
  config: null,
  deployed: null,
  deploymentPending: true,
  record: pendingDeploymentRecord,
};
const {
  currentConfig: _currentConfig,
  deployment: _deployment,
  ...watchedUndeployedRecord
} = argentMultisig.record;
const watchedUndeployedMultisig: ArgentMultisigView = {
  authorityStatus: "undeployed",
  config: null,
  deployed: false,
  record: watchedUndeployedRecord,
  unsupportedSigners: [],
};
const externalOnlyDeployment: ArgentMultisigView = {
  ...watchedUndeployedMultisig,
  record: {
    ...watchedUndeployedRecord,
    currentConfig: { signerPublicKeys: ["0x999"], threshold: 1 },
    deployment: { salt: "0x0", signerPublicKeys: ["0x999"], threshold: 1 },
  },
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
    "The first-run state explains the two deliberate paths: create a new account or add an existing address.",
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
    { choices: ["create", "add"] },
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
      "Choose participants",
      "The account name and participant identities form the first decision in one four-stage creation flow.",
      { selectedMultisigId: null, view: "multisig-deploy" },
      { class: "declared", step: "participants" },
    ),
    prepare: bindFixtureMultisig,
  },
  {
    ...checkpoint(
      "deploy-participant",
      "Add participant",
      "Known identities stay one tap away while an external participant can be resolved from an address, added from a public key, or imported as a complete wallet card.",
      { selectedMultisigId: null, view: "multisig-deploy" },
      { detailType: "account address", step: "participant" },
    ),
    prepare: revealDeploymentParticipant,
  },
  {
    ...checkpoint(
      "deploy-wallet-card",
      "Add complete wallet contact",
      "A labelled wallet card adds the Starknet signer and authenticated Nostr coordination identity as one participant, then returns to creation.",
      { selectedMultisigId: null, view: "multisig-deploy" },
      { detailType: "wallet card", step: "participant" },
    ),
    prepare: revealDeploymentWalletCard,
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
      "Deployment review",
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
    "A shared counterfactual address can be watched before deployment and replaces the disabled Send action with the exact recovery step.",
    { multisigs: [watchedUndeployedMultisig], view: "multisig-home" },
    { action: "complete setup", deployed: false },
  ),
  checkpoint(
    "home-deployment-pending",
    "Deployment confirming",
    "A submitted deployment cannot reappear as a second deployment action while Starknet confirms it.",
    { multisigs: [pendingDeploymentMultisig], view: "multisig-home" },
    { action: "wait for confirmation", deployed: null },
  ),
  {
    ...checkpoint(
      "deploy-recover",
      "Resume watched address",
      "The wallet collects the missing constructor and binds fee review to the watched address so an incorrect signer set, threshold, or salt cannot deploy a different account.",
      { multisigs: [watchedUndeployedMultisig], view: "multisig-deploy" },
      { constructor: "address-bound", deployed: false },
    ),
    prepare: bindFixtureMultisig,
  },
  checkpoint(
    "signers-watch-only",
    "Unsupported signer type",
    "A passkey or other supported Argent signer stays recognizable and watch-only without asking for an impossible Stark public key.",
    { multisigs: [unsupportedSignerAuthority], view: "multisig-signers" },
    { recovery: "watch only", signerType: "webauthn" },
  ),
  checkpoint(
    "deploy-resume",
    "Resume saved setup",
    "The wallet restores the original signer set, threshold, salt, and eligible deployment signer, then resumes at Approval instead of repeating Participants.",
    { multisigs: [undeployedMultisig], view: "multisig-deploy" },
    { constructor: "restored", deployed: false },
  ),
  {
    ...checkpoint(
      "deploy-signer-required",
      "Deployment signer required",
      "A restored external-only signer set cannot advance until one account owned by this wallet is added as the deployment signer.",
      { multisigs: [externalOnlyDeployment], view: "multisig-deploy" },
      { recovery: "add local signer", step: "participants" },
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
    "home-observer-proposal",
    "Observer can propose",
    "Preparing an off-chain transaction is available even when this browser does not own a signer; signature collection remains a separate capability.",
    { multisigIntents: [], status: observerOnly, view: "multisig-home" },
    { localSigner: "unavailable", proposal: "available" },
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
    "home-stale-intent",
    "One transaction after a fee change",
    "Old fee hashes collapse into one logical row, preserving the strongest signed attempt without crowding the portfolio.",
    {
      multisigIntents: [
        argentStaleIntent,
        argentReplacementIntent,
        { ...argentReplacementIntent, id: `${argentReplacementIntent.id}:empty`, signatures: [] },
      ],
      view: "multisig-home",
    },
    { openIntents: 1, state: "not-submitted", view: "condensed" },
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
    {
      multisigIntents: [
        {
          ...argentCollectingIntent,
          id: `${argentCollectingIntent.id}:other`,
          summary: "Another pending transaction",
        },
        argentReadyIntent,
      ],
      selectedMultisigIntentId: argentReadyIntent.id,
      view: "multisig-detail",
    },
    { signatures: 2, state: "ready", threshold: 2 },
    true,
  ),
  {
    ...checkpoint(
      "intent-handoff",
      "Co-signer handoff",
      "The full package, verified signature import, and advanced fragment export are separated by the job each action performs.",
      { multisigIntents: [argentReadyIntent], view: "multisig-detail" },
      { disclosure: "open", task: "co-signer handoff" },
      true,
    ),
    prepare: revealCollaboration,
  },
  checkpoint(
    "intent-submitted",
    "Transaction submitted",
    "A completed multisig submission becomes a familiar receipt with direct Activity and shared-account destinations.",
    {
      multisigIntents: [argentSubmittedIntent],
      selectedMultisigIntentId: argentSubmittedIntent.id,
      view: "multisig-detail",
    },
    { outcome: "submitted", state: "receipt" },
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
    "Not submitted · retry or update",
    "A fee-rejected attempt says nothing was sent, makes the existing fee update the recommended next step, and keeps the exact signed retry available as a fallback.",
    {
      multisigIntents: [argentStaleIntent, argentReplacementIntent],
      selectedMultisigIntentId: argentStaleIntent.id,
      view: "multisig-detail",
    },
    { state: "not-submitted" },
    true,
  ),
  {
    ...checkpoint(
      "intent-fee-replacement",
      "Fee-updated transaction",
      "The replacement explains that its new hash cannot reuse approvals from the previous attempt.",
      {
        multisigIntents: [argentStaleIntent, argentReplacementIntent],
        selectedMultisigIntentId: argentReplacementIntent.id,
        view: "multisig-detail",
      },
      { lifecycle: "replacement", signatures: 1, threshold: 2 },
      true,
    ),
    prepare: revealIntentTechnical,
  },
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
      "signers-participant",
      "Add signer participant",
      "Signer management uses the same participant task and returns to threshold review after a public key is selected.",
      { view: "multisig-signers" },
      { detailType: "public key", step: "participant" },
    ),
    prepare: revealManagementParticipant,
  },
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
