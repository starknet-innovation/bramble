/**
 * Percent-change pill — green when non-negative, red when negative. Ported from
 * the mockup's `.pos`/`.neg` change cells.
 */
import type { ReactNode } from "react";

export type PctChangeProps = {
  /** The change as a number in percent (e.g. 6.34 or -3.4). */
  readonly value: number;
  /** Fraction digits to display. Defaults to 2. */
  readonly digits?: number;
  /** Render as an inline pill (`.pill`) instead of bare text. Defaults false. */
  readonly pill?: boolean;
  readonly className?: string;
};

/**
 * Formats a signed percentage with a leading + / - and the pos/neg color class.
 */
export const PctChange = ({
  value,
  digits = 2,
  pill = false,
  className,
}: PctChangeProps): ReactNode => {
  const tone = value < 0 ? "neg" : "pos";
  const sign = value < 0 ? "" : "+";
  const text = `${sign}${value.toFixed(digits)}%`;
  const classes = ["pct", "mono", tone, pill ? "pill" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return <span className={classes}>{text}</span>;
};
