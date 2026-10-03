import type { Meta, StoryObj } from "@storybook/html-vite";
import { expect, userEvent, waitFor } from "storybook/test";
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
 * chain's reason, and Try again is the one primary action. Guards the shared
 * receipt against painting "complete" over a transaction that did not land.
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
    const actions = section?.querySelector('[data-outcome-actions="failed"]');
    await expect(actions).toBeVisible();
    await expect(section?.querySelector('[data-outcome-actions="succeeded"]')).not.toBeVisible();
    const primary = Array.from(actions?.querySelectorAll("button:not(.secondary)") ?? []);
    await expect(primary.map((control) => control.textContent?.trim())).toEqual(["Try again"]);
  },
});

/**
 * The width the extension is laid out at in the browser side panel. The project
 * documents 320 CSS px as that panel's minimum width (with 256 px under zoom),
 * so this is the narrowest width a screen has to survive.
 */
const MINIMUM_SIDEPANEL_WIDTH = 320;

type LabFrameView = {
  readonly frame: HTMLIFrameElement;
  readonly document: Document;
  readonly body: HTMLElement;
};

const labFrameView = (canvasElement: HTMLElement): LabFrameView => {
  const frame = canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]");
  const document = frame?.contentDocument ?? null;
  if (!frame || !document?.body) {
    throw new Error("UI Lab wallet frame is unavailable");
  }
  return { body: document.body, document, frame };
};

/**
 * The side panel has no horizontal scrollbar, so anything past the right edge
 * is simply unreachable. Both the root element and the body are checked because
 * a positioned or grid child can widen either one.
 */
const assertNoHorizontalOverflow = (document: Document): void => {
  const root = document.documentElement;
  expect(root.scrollWidth, "the panel scrolls horizontally").toBeLessThanOrEqual(root.clientWidth);
  expect(document.body.scrollWidth, "the panel body scrolls horizontally").toBeLessThanOrEqual(
    root.clientWidth,
  );
};

/**
 * A value the user must read at the minimum width, such as an amount or a fee:
 * its box stays inside the panel edge and its own text is not clipped away.
 * Addresses the design deliberately truncates behind a copy control are checked
 * with {@link assertInsidePanel} instead.
 */
export const assertValueFits = (document: Document, selector: string): void => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Expected ${selector} at the minimum side-panel width`);
  }
  const width = document.documentElement.clientWidth;
  const rect = element.getBoundingClientRect();
  expect(rect.left, `${selector} starts left of the panel`).toBeGreaterThanOrEqual(-1);
  expect(rect.right, `${selector} runs past the panel edge`).toBeLessThanOrEqual(width + 1);
  expect(element.scrollWidth, `${selector} clips its own value`).toBeLessThanOrEqual(
    element.clientWidth + 1,
  );
};

/**
 * A value that may truncate by design but must still sit inside the panel: only
 * the element's box is checked, not its internal overflow.
 */
export const assertInsidePanel = (document: Document, selector: string): void => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Expected ${selector} at the minimum side-panel width`);
  }
  const width = document.documentElement.clientWidth;
  const rect = element.getBoundingClientRect();
  expect(rect.left, `${selector} starts left of the panel`).toBeGreaterThanOrEqual(-1);
  expect(rect.right, `${selector} runs past the panel edge`).toBeLessThanOrEqual(width + 1);
};

export type NarrowStoryCheck = (document: Document, body: HTMLElement) => void;

/**
 * Renders one checkpoint at the browser side panel's minimum width and asserts
 * the panel neither scrolls horizontally nor loses the values the caller names.
 * It drives the review bench's own surface control, so the check exercises the
 * same rendering path a reviewer sees rather than a bespoke fixture width.
 */
export const narrowSidepanelStory = (
  name: string,
  scenarioId: string,
  checkpointId: string,
  checks: readonly NarrowStoryCheck[] = [],
): LabStory => ({
  args: { checkpointId, scenarioId },
  name,
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const control = canvasElement.querySelector<HTMLButtonElement>(
      '[data-surface="sidepanel-min"]',
    );
    if (!control) {
      throw new Error("The minimum-width surface control is missing from the review bench");
    }
    await userEvent.click(control);
    await assertCheckpointReady(canvasElement);
    const { body, document, frame } = labFrameView(canvasElement);
    // Guard the bench arithmetic: a device that does not lay the frame out at
    // the minimum width would silently widen every assertion below.
    expect(
      Math.round(frame.getBoundingClientRect().width),
      "the review bench does not render the minimum side-panel width",
    ).toBe(MINIMUM_SIDEPANEL_WIDTH);
    assertNoHorizontalOverflow(document);
    for (const check of checks) {
      check(document, body);
    }
  },
});
