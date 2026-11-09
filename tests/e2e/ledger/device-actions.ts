/**
 * On-device steps for the emulated Ledger, per model family. Nano S+ is driven
 * with buttons (`/button`), Flex and Stax with the touchscreen (`/finger`).
 *
 * Sequences and touch points come from the pinned app's own Ragger tests
 * (app-starknet 2.4.3, `tests/test_sign_hash.py`) and Ragger 1.47.4's touch
 * positions, so they track the screens that app version draws. Where a step
 * depends on a label, the suite waits for that label first: a screen change
 * fails loudly with the text that was on screen instead of tapping blind.
 *
 * Test-only. Nothing in `apps/` or `packages/` may import this file.
 */
import type { LedgerModel } from "./dashboard";
import type { SpeculosScreen } from "./speculos";

type TouchLayout = {
  readonly centeredFooter: readonly [number, number];
  readonly center: readonly [number, number];
  readonly confirm: readonly [number, number];
  readonly height: number;
  readonly lowerLeft: readonly [number, number];
  readonly settings: readonly [number, number];
  readonly settingsPerPage: number;
  readonly width: number;
  readonly header: number;
  readonly footer: number;
};

// Ragger firmware/touch/positions.py (1.47.4) and test_sign_hash.py.
const TOUCH: Readonly<Record<"flex" | "stax", TouchLayout>> = {
  flex: {
    center: [240, 300],
    centeredFooter: [240, 550],
    confirm: [240, 435],
    footer: 96,
    header: 96,
    height: 600,
    lowerLeft: [55, 530],
    settings: [405, 75],
    settingsPerPage: 2,
    width: 480,
  },
  stax: {
    center: [200, 336],
    centeredFooter: [200, 606],
    confirm: [200, 515],
    footer: 92,
    header: 88,
    height: 672,
    lowerLeft: [36, 606],
    settings: [342, 55],
    settingsPerPage: 3,
    width: 400,
  },
};

// The first screen of a hash review: with Blind signing on, the app opens it
// with its "Blind signing ahead" warning (Flex, Stax) or "Review hash". The
// settings page reads "Blind signing" too, so the pattern must not match that.
const REVIEW = /review hash|blind signing ahead/i;
// The Nano breaks a hyphenated word across lines ("clear-" / "signed"), and
// screen text joins lines with a space, so the break may be whitespace.
const BLIND_SIGNING_OFF = /cannot be clear-\s*signed|enable blind-\s*signing/i;
const MAX_NANO_STEPS = 12;

/** Presses right until `pattern` is on screen, collecting every screen seen. */
const nanoRightUntil = async (
  screen: SpeculosScreen,
  pattern: RegExp,
  seen: string[],
): Promise<void> => {
  for (let step = 0; step < MAX_NANO_STEPS; step += 1) {
    const text = await screen.text();
    seen.push(text);
    if (pattern.test(text)) {
      return;
    }
    await screen.press("right");
  }
  throw new Error(`Nano never reached ${pattern}; screens: ${seen.join(" | ")}`);
};

/** Turns on the app's Blind signing setting from its home screen. */
export const enableBlindSigning = async (
  screen: SpeculosScreen,
  model: LedgerModel,
): Promise<void> => {
  await screen.waitFor(/starknet|app is ready/i);
  if (model === "nanosp") {
    await screen.press("right");
    await screen.press("both");
    await screen.press("both");
    // The toggle flips the setting; prove it is now on, not flipped back off.
    await screen.waitFor(/\bEnabled\b/);
    return;
  }
  const layout = TOUCH[model];
  await screen.touch(...layout.settings);
  const usable = layout.height - (layout.header + layout.footer);
  const rowHeight = Math.floor(usable / layout.settingsPerPage);
  await screen.touch(layout.width / 2, layout.header + Math.floor(rowHeight / 2));
};

/**
 * Approves a pending blind-signed hash review. Returns the text of every
 * screen shown, so the caller can compare the hash the device displayed.
 */
export const approveHashReview = async (
  screen: SpeculosScreen,
  model: LedgerModel,
): Promise<string> => {
  const seen = [await screen.waitFor(REVIEW, 30_000)];
  if (model === "nanosp") {
    await screen.press("both");
    await nanoRightUntil(screen, /sign hash|approve|accept/i, seen);
    await screen.press("both");
    return seen.join(" ");
  }
  const layout = TOUCH[model];
  await screen.touch(...layout.centeredFooter);
  seen.push(await screen.text());
  await screen.swipeLeft(...layout.center);
  seen.push(await screen.text());
  await screen.swipeLeft(...layout.center);
  seen.push(await screen.text());
  // Hold to sign: the SDK needs at least 2.4 s.
  await screen.touch(...layout.confirm, 3);
  return seen.join(" ");
};

/** Rejects a pending hash review on the device. */
export const rejectHashReview = async (
  screen: SpeculosScreen,
  model: LedgerModel,
): Promise<void> => {
  await screen.waitFor(REVIEW, 30_000);
  if (model === "nanosp") {
    await screen.press("both");
    await nanoRightUntil(screen, /reject/i, []);
    await screen.press("both");
    return;
  }
  const layout = TOUCH[model];
  await screen.touch(...layout.centeredFooter);
  await screen.touch(...layout.lowerLeft);
  // NBGL asks "Reject message?"; tap its "Yes, reject" where it is drawn. The
  // title also says "Reject", so match the confirming label exactly.
  await screen.waitFor(/yes, reject/i);
  const confirm = (await screen.texts()).find((event) => /^\s*yes, reject\s*$/i.test(event.text));
  if (!confirm) {
    throw new Error("The device's reject confirmation has no Yes, reject label");
  }
  await screen.touch(confirm.x + (confirm.w ?? 8) / 2, confirm.y + (confirm.h ?? 8) / 2);
};

/**
 * Answers the app's "cannot be clear-signed" prompt (blind signing off) with
 * its reject choice.
 */
export const rejectBlindSigningPrompt = async (
  screen: SpeculosScreen,
  model: LedgerModel,
): Promise<string> => {
  const prompt = await screen.waitFor(BLIND_SIGNING_OFF, 30_000);
  if (model === "nanosp") {
    await nanoRightUntil(screen, /reject transaction/i, []);
    await screen.press("both");
    return prompt;
  }
  await screen.touch(...TOUCH[model].lowerLeft);
  return prompt;
};
