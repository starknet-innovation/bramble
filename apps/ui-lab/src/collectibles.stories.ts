import { checkpointStory, LAB_META, type LabMeta } from "./story-helpers";

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
export const Submitted = checkpointStory("Transfer submitted", "nft", "submitted");
