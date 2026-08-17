import { expect } from "storybook/test";
import { RECIPIENT_ADDRESS } from "../../fixtures/fixtures";
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
export const Watch: LabStory = {
  args: { checkpointId: "watch", scenarioId: "multisig" },
  name: "Watch existing account",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelectorAll("#multisig-add-form input")).toHaveLength(1);
    await expect(body?.querySelector('input[name="address"]')).toBeVisible();
    await expect(body?.querySelector('button[type="submit"]')).toHaveTextContent("Sync multisig");
  },
};
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
export const DeployReviewed: LabStory = {
  args: { checkpointId: "deploy-reviewed", scenarioId: "multisig" },
  name: "Deployment · reviewed",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector(".multisig-deployment-target")).toBeVisible();
    await expect(body?.querySelector("#multisig-deploy-review")).toHaveTextContent(
      "Maximum network fee: 0.252237 STRK",
    );
    await expect(body?.querySelector<HTMLButtonElement>('button[type="submit"]')).toHaveTextContent(
      "Deploy reviewed account",
    );
  },
};
export const DeployFunding: LabStory = {
  args: { checkpointId: "deploy-funding", scenarioId: "multisig" },
  name: "Deployment · funding required",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector("#multisig-deploy-review")).toHaveTextContent(
      "Funding is required first",
    );
    await expect(body?.querySelector<HTMLButtonElement>('button[type="submit"]')).toHaveTextContent(
      "Check funding again",
    );
  },
};
export const HomeDeploymentRequired: LabStory = {
  args: { checkpointId: "home-deployment-required", scenarioId: "multisig" },
  name: "Home · deployment required",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector('[data-view="multisig-deploy"]')).toHaveTextContent("Deploy");
    await expect(body?.querySelector(".multisig-action-note")).toHaveTextContent(
      "Deploy this saved account",
    );
    await expect(body?.querySelector('[data-view="multisig-propose"]')).not.toBeInTheDocument();
  },
};
export const DeployResume: LabStory = {
  args: { checkpointId: "deploy-resume", scenarioId: "multisig" },
  name: "Deployment · saved setup",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector("#multisig-deploy-form")).toHaveTextContent("2 signers");
    await expect(body?.querySelector('input[name="threshold"]')).toHaveValue("2");
    await expect(body?.querySelector('input[name="salt"]')).toHaveValue("0x0");
    await expect(body?.querySelector('button[type="submit"]')).toBeEnabled();
  },
};
export const Home = checkpointStory("Shared portfolio", "multisig", "home");
export const HomeEmpty: LabStory = {
  args: { checkpointId: "home-empty", scenarioId: "multisig" },
  name: "Home · import first intent",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector('[data-view="multisig-track"]')).toHaveTextContent(
      "Import intent",
    );
    await expect(body?.querySelector(".multisig-primary-actions")).not.toHaveTextContent("Import");
  },
};
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
export const Propose: LabStory = {
  args: { checkpointId: "propose", scenarioId: "multisig" },
  name: "Compose token transfer",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector('#multisig-propose-form input[name="recipient"]')).toHaveValue(
      RECIPIENT_ADDRESS,
    );
    await expect(body?.querySelector('#multisig-propose-form input[name="amount"]')).toHaveValue(
      "25",
    );
    await expect(body?.querySelector("#multisig-selected-token-glyph .token-logo")).toBeVisible();
    await expect(
      body?.querySelector('#multisig-propose-form button[type="submit"]'),
    ).toHaveTextContent("Review transaction");
    await expect(body?.querySelector(".multisig-advanced-call")).not.toHaveAttribute("open");
  },
};
export const ProposeAdvanced: LabStory = {
  args: { checkpointId: "propose-advanced", scenarioId: "multisig" },
  name: "Compose · advanced contract call",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector(".multisig-advanced-call")).toHaveAttribute("open");
    await expect(body?.querySelector('[data-ms-prepare="contract"]')).toBeVisible();
    await expect(body?.querySelector('[data-ms-prepare="contract"]')).toHaveTextContent(
      "Review contract call",
    );
  },
};
export const SyncError = checkpointStory("Shared-account sync failure", "multisig", "sync-error");
