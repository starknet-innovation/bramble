import { expect } from "storybook/test";
import {
  assertCheckpointReady,
  checkpointStory,
  LAB_META,
  type LabMeta,
  type LabStory,
} from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "home", scenarioId: "multisig" },
  title: "Wallet journeys/09 Argent multisig",
};

export default meta;

export const Empty = checkpointStory("No shared accounts", "multisig", "empty");
export const Accounts = checkpointStory("Shared account list", "multisig", "list");
export const ChooseSetup: LabStory = {
  args: { checkpointId: "add", scenarioId: "multisig" },
  name: "Choose setup path",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelectorAll(".multisig-setup-option")).toHaveLength(2);
    await expect(body?.querySelector(".multisig-setup-options")).toBeVisible();
  },
};
export const Watch = checkpointStory("Watch existing account", "multisig", "watch");
export const DeployUnavailable = checkpointStory(
  "Deployment unavailable",
  "multisig",
  "deploy-class-check",
);
export const Deploy: LabStory = {
  args: { checkpointId: "deploy-ready", scenarioId: "multisig" },
  name: "Review deployment inputs",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector("[data-multisig-deploy-summary] [data-copy]")).toBeVisible();
    await expect(body?.querySelector(".multisig-deployment-signer .option-avatar")).toBeVisible();
    await expect(body?.querySelector(".multisig-signer-set")).toBeVisible();
    await expect(body?.querySelector(".multisig-selected-signer:not([hidden])")).toBeVisible();
    await expect(body?.querySelector(".multisig-signer-sources > summary")).toBeVisible();
    await expect(body?.querySelector('input[name="signerPublicKeys"]')).toHaveAttribute(
      "type",
      "hidden",
    );
    await expect(body?.querySelector('input[name="signerAccountId"]')).toHaveAttribute(
      "type",
      "hidden",
    );
    const addSigner = body?.querySelector<HTMLButtonElement>(
      "[data-add-signer-public-key]:not([hidden])",
    );
    addSigner?.click();
    await expect(body?.querySelector("[data-signer-count]")).toHaveTextContent("2 signers");
    const addedKey = addSigner?.dataset["addSignerPublicKey"];
    const removeSigner = [
      ...(body?.querySelectorAll<HTMLButtonElement>("[data-remove-signer-public-key]") ?? []),
    ].find((control) => control.dataset["removeSignerPublicKey"] === addedKey);
    removeSigner?.click();
    await expect(body?.querySelector("[data-signer-count]")).toHaveTextContent("1 signer");
  },
};
export const Home = checkpointStory("Shared portfolio", "multisig", "home");
export const HomeEmpty = checkpointStory("Shared portfolio without work", "multisig", "home-empty");
export const HomeIntents: LabStory = {
  args: { checkpointId: "home-intents", scenarioId: "multisig" },
  name: "Home · condensed open work",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(
      body?.querySelector('.multisig-intent-list [data-view="multisig-detail"]'),
    ).toBeVisible();
    await expect(body?.querySelector(".multisig-intent-assets .token-logo")).toBeVisible();
    await expect(body?.querySelector("[data-ms-intent]")).not.toBeInTheDocument();
  },
};
export const IntentCollecting = checkpointStory(
  "Collect signatures",
  "multisig",
  "intent-collecting",
);
export const IntentReady: LabStory = {
  args: { checkpointId: "intent-ready", scenarioId: "multisig" },
  name: "Ready to submit",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector('[data-ms-home-tab="intents"]')).not.toBeInTheDocument();
    await expect(body?.querySelector("[data-ms-intent]")).toHaveTextContent(/Signatures\s*2 of 2/);
    await expect(
      body?.querySelector("[data-ms-intent] .review-call-assets .token-logo"),
    ).toBeVisible();
    await expect(body?.querySelector("[data-ms-submit]")).toBeVisible();
    await expect(body?.querySelector("[data-ms-sign]")).not.toBeInTheDocument();
    await expect(body?.querySelectorAll(".multisig-intent-action > button")).toHaveLength(1);
    await expect(body?.querySelector(".multisig-collaboration")).not.toHaveAttribute("open");
  },
};
export const IntentLocalSignerComplete: LabStory = {
  args: { checkpointId: "intent-signed-local", scenarioId: "multisig" },
  name: "Collecting · this wallet already signed",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector("[data-ms-sign]")).not.toBeInTheDocument();
    await expect(
      body?.querySelector(".multisig-intent-action > [data-ms-copy-package]"),
    ).toBeVisible();
  },
};
export const IntentNoLocalSigner: LabStory = {
  args: { checkpointId: "intent-no-local-signer", scenarioId: "multisig" },
  name: "Collecting · no eligible local signer",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector("[data-ms-sign]")).not.toBeInTheDocument();
    await expect(
      body?.querySelector(".multisig-intent-action > [data-ms-copy-package]"),
    ).toBeVisible();
  },
};
export const IntentStale = checkpointStory("Stale transaction", "multisig", "intent-stale");
export const AuthorityUnavailable = checkpointStory(
  "Authority unavailable",
  "multisig",
  "authority-unavailable",
);
export const AuthorityChanged = checkpointStory(
  "Authority changed",
  "multisig",
  "authority-changed",
);
export const Signers = checkpointStory("Current signer authority", "multisig", "signers");
export const Track = checkpointStory("Import signing intent", "multisig", "track");
export const Receive = checkpointStory("Receive into multisig", "multisig", "receive");
export const Propose = checkpointStory("Prepare exact transaction", "multisig", "propose");
export const SyncError = checkpointStory("Shared-account sync failure", "multisig", "sync-error");
