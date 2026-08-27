import { checkpointStory, LAB_META, type LabMeta } from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "handoff", scenarioId: "mobile-pq-sign" },
  title: "Wallet journeys/07 Post-quantum phone",
};

export default meta;

export const Handoff = checkpointStory("Signing · handoff", "mobile-pq-sign", "handoff");
export const Verifying = checkpointStory("Signing · verifying", "mobile-pq-sign", "submitting");
export const Refused = checkpointStory("Signing · refused", "mobile-pq-sign", "error");
