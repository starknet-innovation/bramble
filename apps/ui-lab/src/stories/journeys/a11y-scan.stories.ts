import { expect } from "storybook/test";
import {
  inertMarkup,
  SCAN_FRAME_ATTRIBUTE,
  scanWalletDocument,
  scanWalletFrame,
} from "../../runtime/a11y-scan";
import {
  assertCheckpointReady,
  LAB_META,
  type LabMeta,
  type LabStory,
} from "../../runtime/story-helpers";

/**
 * A crafted document with one deliberate defect, so a passing scan proves the
 * engine really ran: an image with no accessible name must be reported whether
 * or not the reviewed wallet is currently clean.
 */
const CONTROL_DOCUMENT =
  '<!doctype html><html lang="en"><head><title>Scan control</title></head>' +
  '<body><main><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" /></main></body></html>';

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "ready", scenarioId: "portfolio" },
  title: "Wallet UI Lab/Accessibility scan",
};

export default meta;

export const EmbeddedWalletReadout: LabStory = {
  name: "Accessibility readout of the embedded wallet document",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const frame = canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]");
    if (!frame) {
      throw new Error("UI Lab wallet frame was not rendered");
    }
    const sandboxBefore = frame.getAttribute("sandbox");

    const control = await scanWalletDocument(CONTROL_DOCUMENT, { width: 400, height: 760 });
    expect(control.map((violation) => violation.id)).toContain("image-alt");

    const violations = await scanWalletFrame(frame);
    const frameDocument = frame.contentDocument;
    expect(frameDocument?.title).toBeTruthy();
    const ids = violations.map((violation) => violation.id);
    expect(ids).not.toContain("document-title");
    // Every flagged node must resolve inside the reviewed document, which is
    // what makes this a readout of the wallet and not of the bench chrome.
    for (const violation of violations) {
      for (const node of violation.nodes) {
        expect(frameDocument?.querySelector(node.target)).not.toBeNull();
      }
    }

    // No residue: the ephemeral twin is gone and the review frame is untouched.
    expect(frame.ownerDocument.querySelector(`[${SCAN_FRAME_ATTRIBUTE}]`)).toBeNull();
    expect(frame.getAttribute("sandbox")).toBe(sandboxBefore);
  },
};

/**
 * A reviewed document that tries to run code: an inline script and an event
 * handler both set a flag on the bench. The twin runs scripts, so the scan must
 * render the markup inert or that code would run with the bench's origin.
 */
const ACTIVE_DOCUMENT =
  '<!doctype html><html lang="en"><head><title>Active control</title>' +
  "<script>parent.__labScanRan = true;</script></head>" +
  '<body><main><img alt="pixel" onload="parent.__labScanRan = true" ' +
  'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" /></main></body></html>';

export const ScanRunsNoDocumentCode: LabStory = {
  name: "Accessibility readout runs none of the reviewed document's code",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const bench = window as Window & { __labScanRan?: boolean };
    bench.__labScanRan = false;
    const inert = inertMarkup(ACTIVE_DOCUMENT);
    expect(inert).not.toContain("<script");
    expect(inert).not.toContain("onload");
    await scanWalletDocument(ACTIVE_DOCUMENT, { width: 400, height: 760 });
    expect(bench.__labScanRan).toBe(false);
  },
};
