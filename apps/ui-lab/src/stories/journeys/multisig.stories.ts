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
export const ChooseSetup = checkpointStory("Choose setup path", "multisig", "add");
export const Watch = checkpointStory("Watch existing account", "multisig", "watch");
export const DeployUnavailable = checkpointStory(
  "Deployment unavailable",
  "multisig",
  "deploy-class-check",
);
export const Deploy = checkpointStory("Review deployment inputs", "multisig", "deploy-ready");
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
    await expect(body?.querySelector("[data-ms-submit]")).toBeVisible();
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
