/**
 * Toast behaviour the iOS toast reproduces, read from the side panel's toast implementation
 * (`shared/dom.ts`): how long each tone stays, the swipe-dismiss thresholds, and the copy-control
 * wording. The values are private constants and literals there, so this module reads that exact
 * source text, as `colors.ts` reads the stylesheet source; a change in shape throws rather than
 * falling back to a remembered number.
 */

/** Source file the toast behaviour is declared in, read from disk by the caller. */
export const TOAST_SOURCE = "packages/presentation/wallet-ui/src/sidepanel/shared/dom.ts";

const one = (source: string, pattern: RegExp, what: string): string => {
  const matches = [...source.matchAll(new RegExp(pattern.source, "g"))];
  const value = matches[0]?.[1];
  if (matches.length !== 1 || value === undefined) {
    throw new Error(`Expected exactly one ${what} in ${TOAST_SOURCE}, found ${matches.length}`);
  }
  return value;
};

/** The toast timings, thresholds and copy labels, in Swift. */
export const renderSwiftToast = (source: string): string[] => {
  const labels = [...source.matchAll(/copy\.setAttribute\("aria-label", "([^"]+)"\);/g)].map(
    (match) => match[1],
  );
  const [copy, copied, failed] = labels;
  if (labels.length !== 3 || !copy || !copied || !failed) {
    throw new Error(`Expected three toast copy labels in ${TOAST_SOURCE}`);
  }
  const values: readonly [string, string, string][] = [
    ["successMs", one(source, /const SUCCESS_TOAST_MS = (\d+);/, "SUCCESS_TOAST_MS"), "Double"],
    ["errorMs", one(source, /const ERROR_TOAST_MS = (\d+);/, "ERROR_TOAST_MS"), "Double"],
    ["swipeVelocity", one(source, /if \(velocity > (\d*\.?\d+) \|\|/, "swipe velocity"), "Double"],
    ["swipeDistance", one(source, /Math\.abs\(dx\) > (\d+)\)/, "swipe distance"), "CGFloat"],
    ["swipeFade", one(source, /1 - Math\.abs\(dx\) \/ (\d+)/, "swipe fade"), "CGFloat"],
    ["copyConfirmMs", one(source, /\}, (\d+)\);\n\};/, "copy confirmation"), "Double"],
  ];
  return [
    "/// Toast behaviour from the side panel's `shared/dom.ts`: tone lifetimes in ms, the",
    "/// swipe-dismiss thresholds (px/ms and px), the copy glyph's confirmation time, and its labels.",
    "enum BrambleToast {",
    ...values.map(([name, value, type]) => `    static let ${name}: ${type} = ${value}`),
    `    static let copyLabel = "${copy}"`,
    `    static let copiedLabel = "${copied}"`,
    `    static let copyFailedLabel = "${failed}"`,
    "}",
    "",
  ];
};
