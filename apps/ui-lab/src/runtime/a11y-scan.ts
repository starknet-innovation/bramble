import axeSource from "axe-core/axe.min.js?raw";

/**
 * Accessibility scan for the wallet document the lab reviews.
 *
 * The review frame is deliberately script-free (`sandbox="allow-forms
 * allow-same-origin"`), and that boundary is what makes reviewing a fixture
 * safe. It also means the frame realm never fires `setTimeout`, so the axe
 * engine's own timers stall there and `axe.run` never settles. This helper
 * renders the live document once more in an ephemeral, offscreen twin frame
 * that is allowed to run the engine, scans that twin's realm, and removes the
 * twin in a `finally`. The review frame is never touched.
 */

/** One rule failure from the axe engine, reduced to serializable data. */
export type A11yViolation = {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly nodes: readonly A11yViolationNode[];
};

/** One element a rule flagged, as a selector plus the engine's own message. */
type A11yViolationNode = {
  readonly target: string;
  readonly message: string;
};

/** Rendered size the scan frame must match so media queries and layout agree. */
export type ScanSize = {
  readonly width: number;
  readonly height: number;
};

/** Default ceiling for one scan. A regression must fail loudly, not hang. */
const SCAN_TIMEOUT_MS = 30_000;

/** How far offscreen the twin sits. It must stay rendered, never `hidden`. */
const OFFSCREEN_OFFSET_PX = 20_000;

/** Attributes the ephemeral twin so a test can prove it was cleaned up. */
export const SCAN_FRAME_ATTRIBUTE = "data-lab-scan-frame";

/**
 * Runs inside the twin's realm. `resultTypes` keeps the payload small, and the
 * readout is serialized to JSON so only plain data crosses back to the bench.
 */
const violationsAsJson = `(() =>
  axe.run(document, { resultTypes: ["violations"] }).then((result) =>
    JSON.stringify(
      result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? null,
        help: violation.help,
        nodes: violation.nodes.map((node) => ({
          target: node.target.join(" "),
          message: node.failureSummary ?? "",
        })),
      })),
    ),
  ))()`;

const withTimeout = async <T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const parseViolations = (json: string): readonly A11yViolation[] => {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("UI Lab accessibility scan returned an unexpected readout");
  }
  return parsed as readonly A11yViolation[];
};

/** The part of a frame's window this module uses: its own `eval`, plus nothing else. */
type EvalRealm = Window & { readonly eval: (code: string) => unknown };

const runAxe = async (frame: HTMLIFrameElement): Promise<readonly A11yViolation[]> => {
  const realm = frame.contentWindow as EvalRealm | null;
  if (!realm) {
    throw new Error("UI Lab accessibility scan frame has no window");
  }
  void realm.eval(axeSource);
  const json = (await realm.eval(violationsAsJson)) as string;
  return parseViolations(json);
};

/**
 * Scans a standalone document string at a fixed size in a script-enabled twin
 * frame. The twin is same-origin so the bench can inject the engine and read
 * the readout; it carries no navigation capability and is removed afterwards.
 */
export const scanWalletDocument = async (
  markup: string,
  size: ScanSize,
  timeoutMs: number = SCAN_TIMEOUT_MS,
): Promise<readonly A11yViolation[]> => {
  const host = globalThis.document;
  const frame = host.createElement("iframe");
  frame.setAttribute(SCAN_FRAME_ATTRIBUTE, "");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.setAttribute("sandbox", "allow-same-origin allow-scripts");
  frame.style.cssText = [
    "position:fixed",
    "top:0",
    `left:-${OFFSCREEN_OFFSET_PX}px`,
    "border:0",
    `width:${Math.max(1, Math.round(size.width))}px`,
    `height:${Math.max(1, Math.round(size.height))}px`,
  ].join(";");
  frame.srcdoc = markup;
  host.body.append(frame);
  try {
    await withTimeout(
      new Promise<void>((resolve) => {
        frame.addEventListener("load", () => resolve(), { once: true });
      }),
      timeoutMs,
      "UI Lab accessibility scan frame did not load",
    );
    return await withTimeout(
      runAxe(frame),
      timeoutMs,
      "axe-core did not settle in the UI Lab scan frame",
    );
  } finally {
    frame.remove();
  }
};

/**
 * Scans the wallet document the given review frame currently shows. The live
 * DOM is serialized (checkpoint `prepare` hooks mutate it after load) and the
 * twin is sized to the frame's rendered box so contrast and layout agree.
 */
export const scanWalletFrame = async (
  frame: HTMLIFrameElement,
  timeoutMs: number = SCAN_TIMEOUT_MS,
): Promise<readonly A11yViolation[]> => {
  const frameDocument = frame.contentDocument;
  if (!frameDocument?.documentElement) {
    throw new Error("UI Lab wallet frame has no document to scan");
  }
  const box = frame.getBoundingClientRect();
  return scanWalletDocument(
    `<!doctype html>\n${frameDocument.documentElement.outerHTML}`,
    { width: box.width, height: box.height },
    timeoutMs,
  );
};
