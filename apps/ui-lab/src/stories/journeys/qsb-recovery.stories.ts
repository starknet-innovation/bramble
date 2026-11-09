import {
  assertValueFits,
  checkpointStory,
  LAB_META,
  type LabMeta,
  narrowSidepanelStory,
} from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "qsb-recover-offer", scenarioId: "qsb-recovery" },
  title: "Wallet journeys/15 QSB recovery",
};

export default meta;

const story = (name: string, id: string) => checkpointStory(name, "qsb-recovery", id);

export const Offer = story("Read-only QSB vault · Recover deposits", "qsb-recover-offer");
export const Warning = story(
  "Recover deposits · outside custody conformance",
  "qsb-recover-warning",
);
export const Running = story("Recover deposits · recovering", "qsb-recover-running");
export const Done = story("Recover deposits · recovered", "qsb-recover-done");
export const EmergencyReview = story("Release · emergency review", "qsb-release-emergency");

// The narrowest side panel: both warnings stay inside the panel and readable.
export const WarningNarrow = narrowSidepanelStory(
  "Recover deposits warning · 320px",
  "qsb-recovery",
  "qsb-recover-warning",
  [
    (document) =>
      assertValueFits(document, '[data-qsb-account-step="recover"] .qsb-binding-warning'),
  ],
);
export const EmergencyReviewNarrow = narrowSidepanelStory(
  "Emergency release review · 320px",
  "qsb-recovery",
  "qsb-release-emergency",
  [
    (document) => assertValueFits(document, "#qsb-custody-warning"),
    (document) => assertValueFits(document, "#qsb-binding-warning"),
  ],
);
