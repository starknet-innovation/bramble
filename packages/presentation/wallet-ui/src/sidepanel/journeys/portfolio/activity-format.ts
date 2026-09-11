/**
 * Display shaping for activity summaries. Stored summaries keep the amount at
 * full token precision (they are load-bearing: reconciliation and de-dup match
 * on them), so the feed trims figures only at render time: a decimal longer
 * than four places is cut to four through the shared amount policy, a shorter
 * one is left exactly as written. Hex identifiers carry no decimal point and
 * are never touched.
 */
import { compactAmount } from "./token-row";

// Decimal places an activity row shows at most.
const ACTIVITY_FRACTION_PLACES = 4;

// A decimal figure: digits (optionally grouped) with a fractional part, not
// attached to a word or a hex string on either side.
const DECIMAL_FIGURE = /(?<![\w.])(\d[\d,]*\.\d+)(?![\w.])/g;

/**
 * Returns the summary with every decimal figure trimmed to at most four places.
 */
export const compactSummary = (summary: string): string =>
  summary.replace(DECIMAL_FIGURE, (figure) => {
    const [, fraction = ""] = figure.split(".");
    return fraction.length > ACTIVITY_FRACTION_PLACES
      ? compactAmount(figure.replace(/,/g, ""), ACTIVITY_FRACTION_PLACES)
      : figure;
  });
