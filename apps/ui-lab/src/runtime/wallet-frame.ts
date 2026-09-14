import { darkSkin } from "@bramble/ui-kit/dark-skin";
import { defaultSkin } from "@bramble/ui-kit/default-skin";
import { SIDEPANEL_STYLES } from "@bramble/wallet-ui/lab";
import type { LabSurface, LabTheme } from "./types";

const DESIGN_CONTRACT = `
<!--
THESIS: A precise review bench makes wallet state, motion, and trust boundaries inspectable.
OWN-WORLD: Bramble Clean Mono; near-neutral surfaces with one accent, honest success and failure colour.
STORY: Choose a scenario, inspect the wallet, step through its state machine, then leave feedback.
FIRST VIEWPORT: The wallet frame and current checkpoint lead; controls and evidence sit beside it.
FORM: A workbench, not a marketing page. Dense enough for review, quiet enough for concentration.
-->`;

// Emitted after the production stylesheet so the frame's `color-scheme` wins
// over the base layer's dark default, the way the extension entrypoint pins it
// inline on the root. Anything resolved through `light-dark()` — and every
// native control — then follows the selected skin.
const skinCss = (theme: LabTheme): string => {
  const skin = theme === "light" ? defaultSkin : darkSkin;
  const tokens = Object.entries(skin.tokens)
    .map(([name, value]) => `${name}:${value};`)
    .join("");
  return `:root{${tokens}color-scheme:${theme};}`;
};

const reducedMotionCss = (reducedMotion: boolean): string =>
  reducedMotion
    ? "*,:before,:after{animation-duration:0.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:0.01ms!important;}"
    : "";

const surfaceClass = (surface: LabSurface): string =>
  surface === "popup" ? "popup-surface" : surface === "fullpage" ? "onboarding-surface" : "";

/**
 * Builds an isolated document with the exact production wallet skin and
 * stylesheet. Content and extra CSS must be trusted fixture/catalog constants;
 * no live wallet or RPC data reaches this UI Lab boundary.
 */
export const walletFrameDocument = (
  content: string,
  surface: LabSurface,
  theme: LabTheme,
  reducedMotion: boolean,
  extraStyles = "",
): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${SIDEPANEL_STYLES}${skinCss(theme)}${reducedMotionCss(reducedMotion)}${extraStyles}</style>
</head>
<body class="${surfaceClass(surface)}">
  ${DESIGN_CONTRACT}
  <main id="app"><section class="shell">${content}</section></main>
  <div id="toast-stack" class="toast-stack" aria-live="polite"></div>
</body>
</html>`;

type LoadedWalletFrame = {
  readonly app: HTMLElement;
  readonly document: Document;
};

export type PreparedWalletFrame = LoadedWalletFrame & {
  readonly commit: () => HTMLIFrameElement;
  readonly discard: () => void;
};

type TransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

const loadWalletFrame = async (
  frame: HTMLIFrameElement,
  content: string,
  surface: LabSurface,
  theme: LabTheme,
  reducedMotion: boolean,
): Promise<LoadedWalletFrame> => {
  const walletFrame = frame;
  const loaded = new Promise<void>((resolve) => {
    walletFrame.addEventListener("load", () => resolve(), { once: true });
  });
  walletFrame.srcdoc = walletFrameDocument(content, surface, theme, reducedMotion);
  await loaded;
  const document = walletFrame.contentDocument;
  const app = document?.querySelector<HTMLElement>("#app");
  if (!document || !app) {
    throw new Error("UI Lab wallet frame failed to initialize");
  }
  return { app, document };
};

/**
 * Builds and prepares a checkpoint in a transparent sibling frame. The old
 * checkpoint stays visible until fixture setup is complete, preventing default
 * or terminal states from flashing during playback.
 */
export const prepareWalletFrame = async (
  current: HTMLIFrameElement,
  content: string,
  surface: LabSurface,
  theme: LabTheme,
  reducedMotion: boolean,
): Promise<PreparedWalletFrame> => {
  const parent = current.parentElement;
  if (!parent) {
    throw new Error("UI Lab wallet frame has no device mount");
  }
  const next = current.cloneNode(false) as HTMLIFrameElement;
  next.removeAttribute("data-lab-frame");
  next.classList.add("is-preparing");
  next.dataset["reducedMotion"] = String(reducedMotion);
  parent.insertBefore(next, current.nextSibling);
  const loaded = await loadWalletFrame(next, content, surface, theme, reducedMotion).catch(
    (error: unknown) => {
      next.remove();
      throw error;
    },
  );
  const transitionDocument = loaded.document as TransitionDocument;
  const transitionDescriptor = Object.getOwnPropertyDescriptor(
    transitionDocument,
    "startViewTransition",
  );
  Object.defineProperty(transitionDocument, "startViewTransition", {
    configurable: true,
    value: undefined,
  });
  let settled = false;
  return {
    ...loaded,
    commit: () => {
      if (settled) {
        return next;
      }
      settled = true;
      current.removeAttribute("data-lab-frame");
      current.classList.add("is-leaving");
      next.setAttribute("data-lab-frame", "");
      next.classList.remove("is-preparing");
      next.classList.add("is-active");
      if (transitionDescriptor) {
        Object.defineProperty(transitionDocument, "startViewTransition", transitionDescriptor);
      } else {
        Reflect.deleteProperty(transitionDocument, "startViewTransition");
      }
      globalThis.setTimeout(() => current.remove(), 220);
      return next;
    },
    discard: () => {
      if (!settled) {
        settled = true;
        next.remove();
      }
    },
  };
};
