import {
  checkpointStory,
  failedReceiptStory,
  LAB_META,
  type LabMeta,
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
