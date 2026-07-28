import { expect, userEvent, within } from "storybook/test";
import { WALLET_VIEWS } from "../../../src/sidepanel/views";
import { walletScenarios } from "./scenarios";
import { assertCheckpointReady, LAB_META, type LabMeta, type LabStory } from "./story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "ready", scenarioId: "portfolio" },
  title: "Wallet UI Lab/Contracts",
};

export default meta;

export const ProductionViewCoverage: LabStory = {
  name: "Every production view is covered",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const covered = new Set(walletScenarios.flatMap((scenario) => scenario.views ?? []));
    expect(WALLET_VIEWS.filter((view) => !covered.has(view))).toEqual([]);
    expect(new Set(walletScenarios.map((scenario) => scenario.id)).size).toBe(
      walletScenarios.length,
    );
    for (const scenario of walletScenarios) {
      expect(new Set(scenario.checkpoints.map((checkpoint) => checkpoint.id)).size).toBe(
        scenario.checkpoints.length,
      );
    }
  },
};

export const GuidedSendWalkthrough: LabStory = {
  args: { checkpointId: "asset", scenarioId: "send" },
  name: "Step through Send",
  play: async ({ canvasElement, step }) => {
    await assertCheckpointReady(canvasElement);
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Choose asset" }),
    ).toBeVisible();
    await step("Advance into deterministic review latency", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Step" }));
      await assertCheckpointReady(canvasElement);
      await expect(
        await canvas.findByRole("heading", { level: 2, name: "Preparing review" }),
      ).toBeVisible();
    });
    await step("Advance into the decoded review", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Step" }));
      await assertCheckpointReady(canvasElement);
      await expect(
        await canvas.findByRole("heading", { level: 2, name: "Review ready" }),
      ).toBeVisible();
    });
  },
};
