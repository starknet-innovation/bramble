import type { Meta, StoryObj } from "@storybook/html-vite";
import { expect, waitFor } from "storybook/test";
import { createUiLab } from "./lab-runtime";

type LabArgs = {
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
          "A fixture-only review bench that renders Bramble production HTML, CSS, bindings, and motion. Use Canvas for live motion and the Interactions panel for scripted flow steps; use Chromatic snapshots and comments for durable PR review.",
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
  await waitFor(
    () => {
      const lab = canvasElement.firstElementChild;
      expect(lab).toHaveAttribute("data-lab-ready", "true");
    },
    { timeout: 5_000 },
  );
  const error = canvasElement.querySelector("[data-lab-error]");
  if (error instanceof HTMLElement && !error.hidden) {
    throw new Error(error.textContent?.trim() || "UI Lab checkpoint failed to render");
  }
  const frame = canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]");
  expect(frame?.contentDocument?.querySelector(".shell")).toBeInTheDocument();
  const lab = canvasElement.firstElementChild;
  const device = canvasElement.querySelector<HTMLElement>("[data-lab-device]");
  const surface = device?.dataset["surface"];
  expect(lab).toHaveAttribute("data-lab-surface", surface ?? "");
  if (surface === "fullpage") {
    const main = canvasElement.querySelector<HTMLElement>(".lab-main");
    const view = canvasElement.ownerDocument.defaultView;
    const columns = main && view ? view.getComputedStyle(main).gridTemplateColumns : "";
    expect(columns.trim().split(/\s+/)).toHaveLength(1);
  }
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

/**
 * A receipt checkpoint the chain refused: beyond rendering, the failure mark
 * shows and the success mark does not, under the failure heading and the
 * chain's reason. Guards the shared receipt against painting "complete" over a
 * transaction that did not land.
 */
export const failedReceiptStory = (
  name: string,
  scenarioId: string,
  checkpointId: string,
  receipt: { readonly id: string; readonly reason: string; readonly title: string },
): LabStory => ({
  args: { checkpointId, scenarioId },
  name,
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    const section = body?.querySelector(`#${receipt.id}`);
    await expect(section?.querySelector('[data-outcome-mark="failed"]')).toBeVisible();
    await expect(section?.querySelector('[data-outcome-mark="succeeded"]')).not.toBeVisible();
    await expect(body?.querySelector(`#${receipt.id}-title`)).toHaveTextContent(receipt.title);
    await expect(body?.querySelector(`#${receipt.id}-description`)).toHaveTextContent(
      receipt.reason,
    );
  },
});
