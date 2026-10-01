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
  args: { checkpointId: "gallery", scenarioId: "nft" },
  title: "Wallet journeys/08 Collectibles",
};

export default meta;

export const MetadataLoading = checkpointStory("Metadata loading", "nft", "metadata-loading");
export const Gallery = checkpointStory("Gallery", "nft", "gallery");
export const Detail = checkpointStory("NFT detail", "nft", "detail");
export const Watch = checkpointStory("Watch by contract", "nft", "watch");
export const Hidden = checkpointStory("Hidden collectibles", "nft", "hidden");
export const Recipient = checkpointStory("Choose recipient", "nft", "recipient");
export const TransferReview = checkpointStory("Transfer review", "nft", "review");
export const RecipientBlocked = checkpointStory("Recipient blocked", "nft", "blocked");
// The label names what the screen shows, so the play holds the heading to it.
export const Submitted: LabStory = {
  ...checkpointStory("Transfer complete", "nft", "submitted"),
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector("#nft-success-title")).toHaveTextContent("Transfer complete");
  },
};
export const TransferFailed = failedReceiptStory("Transfer failed", "nft", "failed", {
  id: "nft-success",
  reason: "Starknet reverted this transaction. Review its activity details before retrying.",
  title: "Transfer failed",
});
