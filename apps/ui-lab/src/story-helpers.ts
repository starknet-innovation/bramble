import type { Meta, StoryObj } from "@storybook/html-vite";
import { expect, waitFor } from "storybook/test";
import { createUiLab } from "./lab-runtime";

export type LabArgs = {
  readonly checkpointId: string;
  readonly scenarioId: string;
};

export type LabMeta = Meta<LabArgs>;
export type LabStory = StoryObj<LabArgs>;

export const LAB_META: LabMeta = {
  parameters: {
    chromatic: {
      pauseAnimationAtEnd: true,
    },
    docs: {
      description: {
        component:
          "A fixture-only review bench that renders MC Wallet production HTML, CSS, bindings, and motion. Use Canvas for live motion and the Interactions panel for scripted flow steps; use Chromatic snapshots and comments for durable PR review.",
      },
    },
  },
  render: (args) =>
    createUiLab({
      checkpointId: args.checkpointId,
      scenarioId: args.scenarioId,
    }),
  tags: ["autodocs"],
};

export const assertCheckpointReady = async (canvasElement: HTMLElement): Promise<void> => {
  await waitFor(() => {
    const lab = canvasElement.firstElementChild;
    expect(lab).toHaveAttribute("data-lab-ready", "true");
  });
  const error = canvasElement.querySelector("[data-lab-error]");
  expect(error).not.toBeVisible();
  const frame = canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]");
  expect(frame?.contentDocument?.querySelector(".shell")).toBeInTheDocument();
};

export const checkpointStory = (
  name: string,
  scenarioId: string,
  checkpointId: string,
): LabStory => ({
  args: { checkpointId, scenarioId },
  name,
  play: async ({ canvasElement }) => assertCheckpointReady(canvasElement),
});
