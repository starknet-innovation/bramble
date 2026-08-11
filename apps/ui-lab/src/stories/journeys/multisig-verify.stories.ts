import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  assertCheckpointReady,
  checkpointStory,
  LAB_META,
  type LabMeta,
  type LabStory,
} from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "verify-elsewhere-entry", scenarioId: "multisig" },
  title: "Wallet journeys/09 Multisig/Verify elsewhere",
};

export default meta;

export const Entry = checkpointStory(
  "01 Entry from proposal",
  "multisig",
  "verify-elsewhere-entry",
);
export const ScanOrCopy = checkpointStory(
  "02 Scan or copy package",
  "multisig",
  "independent-review",
);
export const LocalDecoder = checkpointStory(
  "03 Decode locally",
  "multisig",
  "verify-elsewhere-decode",
);
export const DecodedResult = checkpointStory(
  "04 Compare decoded result",
  "multisig",
  "verify-elsewhere-decoded",
);

export const InteractiveWalkthrough: LabStory = {
  args: { checkpointId: "verify-elsewhere-entry", scenarioId: "multisig" },
  name: "05 Interactive walkthrough",
  play: async ({ canvasElement, step }) => {
    await assertCheckpointReady(canvasElement);
    const frame = canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]");
    const body = frame?.contentDocument?.body;
    expect(body).toBeTruthy();
    if (!body) return;
    const wallet = within(body);

    await step("Open Verify elsewhere from the decoded proposal", async () => {
      await userEvent.click(wallet.getByRole("button", { name: "Verify elsewhere" }));
      await waitFor(() =>
        expect(wallet.getByRole("dialog", { name: "Independent proposal review" })).toBeVisible(),
      );
      await expect(wallet.getByText("Verify on another device")).toBeVisible();
    });

    await step("Open the no-network local decoder", async () => {
      await userEvent.click(wallet.getByText("Decode a package locally"));
      await expect(wallet.getByRole("textbox", { name: "Paste review package" })).toBeVisible();
    });

    await step("Decode the exact public package", async () => {
      const copy = wallet.getByRole("button", { name: "Copy review package" });
      const reviewPackage = copy.getAttribute("data-copy");
      expect(reviewPackage).toBeTruthy();
      const input = wallet.getByRole("textbox", {
        name: "Paste review package",
      }) as HTMLTextAreaElement;
      input.value = reviewPackage ?? "";
      await userEvent.click(wallet.getByRole("button", { name: "Decode locally" }));
      await expect(wallet.getByText("SN_MAIN")).toBeVisible();
      await expect(
        wallet.getByText(
          "Compare the proposal id with the wallet or an on-chain source before approving.",
        ),
      ).toBeVisible();
    });
  },
};
