import { SIDEPANEL_STYLES } from "../../../src/sidepanel/styles";
import { darkSkin } from "../../../src/ui/dark-skin";
import { defaultSkin } from "../../../src/ui/default-skin";
import type { LabSurface, LabTheme } from "./types";

const DESIGN_CONTRACT = `
<!--
THESIS: A precise review bench makes wallet state, motion, and trust boundaries inspectable.
OWN-WORLD: MC Wallet Clean Mono; deep neutral surfaces, cobalt action, honest status colour.
STORY: Choose a scenario, inspect the wallet, step through its state machine, then leave feedback.
FIRST VIEWPORT: The wallet frame and current checkpoint lead; controls and evidence sit beside it.
FORM: A workbench, not a marketing page. Dense enough for review, quiet enough for concentration.
-->`;

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

const frameHtml = (
  content: string,
  surface: LabSurface,
  theme: LabTheme,
  reducedMotion: boolean,
): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${skinCss(theme)}${SIDEPANEL_STYLES}${reducedMotionCss(reducedMotion)}</style>
</head>
<body class="${surfaceClass(surface)}">
  ${DESIGN_CONTRACT}
  <main id="app"><section class="shell">${content}</section></main>
  <div id="toast-stack" class="toast-stack" aria-live="polite"></div>
</body>
</html>`;

export type LoadedWalletFrame = {
  readonly app: HTMLElement;
  readonly document: Document;
};

export const loadWalletFrame = async (
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
  walletFrame.srcdoc = frameHtml(content, surface, theme, reducedMotion);
  await loaded;
  const document = walletFrame.contentDocument;
  const app = document?.querySelector<HTMLElement>("#app");
  if (!document || !app) {
    throw new Error("UI Lab wallet frame failed to initialize");
  }
  return { app, document };
};
