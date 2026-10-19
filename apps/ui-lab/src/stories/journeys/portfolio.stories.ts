import { expect } from "storybook/test";
import {
  assertCheckpointReady,
  checkpointStory,
  failedReceiptStory,
  LAB_META,
  type LabMeta,
  type LabStory,
} from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "ready", scenarioId: "portfolio" },
  title: "Wallet journeys/02 Portfolio",
};

export default meta;

export const SavedData = checkpointStory("Portfolio saved data", "portfolio", "saved-data");
export const Ready = checkpointStory("Portfolio ready", "portfolio", "ready");
export const MajorActions = checkpointStory(
  "Portfolio · four major actions",
  "portfolio",
  "major-actions",
);
export const QuickActions = checkpointStory(
  "Portfolio quick actions",
  "portfolio",
  "quick-actions",
);
export const AccountDrawer = checkpointStory("Account drawer", "portfolio", "account-drawer");
export const Undeployed = checkpointStory("Counterfactual account", "portfolio", "undeployed");
// A Braavos counterfactual deploys only through its own step: Home names where,
// Send and Swap stay disabled, and it is not called "Read only".
export const UndeployedBraavos: LabStory = {
  args: { checkpointId: "undeployed-braavos", scenarioId: "portfolio" },
  name: "Undeployed Braavos account",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    const notice = body?.querySelector('[data-read-only="undeployed"]');
    await expect(notice).toHaveTextContent("Not deployed");
    await expect(notice).toHaveTextContent(
      "Deploy this account first (Settings → Deploy account).",
    );
    await expect(body).not.toHaveTextContent("Read only");
    for (const view of ["send", "swap"]) {
      await expect(body?.querySelector(`.action-tile[data-view="${view}"]`)).toBeDisabled();
    }
  },
};
export const DeployAccount = checkpointStory(
  "Deploy account review",
  "portfolio",
  "deploy-account",
);
export const DeploySubmitted = checkpointStory("Account deployed", "portfolio", "deploy-submitted");
export const DeployFailed = failedReceiptStory("Deployment failed", "portfolio", "deploy-failed", {
  id: "deploy-success",
  reason: "Starknet rejected this transaction. Nothing changed.",
  title: "Deployment failed",
});
export const PricesOffline = checkpointStory("Prices unavailable", "portfolio", "prices-offline");
export const BalanceFailed = checkpointStory(
  "Balance refresh failed",
  "portfolio",
  "balance-error",
);
export const EmptyNetwork = checkpointStory("No account on network", "portfolio", "empty-network");
