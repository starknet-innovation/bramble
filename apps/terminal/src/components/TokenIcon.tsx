/**
 * Gradient token/perp icon square, ported from the mockup `.ticon`.
 */
import type { CSSProperties, ReactNode } from "react";
import { iconGradient } from "./palette";

export type TokenIconProps = {
  /** Symbol; the first three characters are shown as the glyph. */
  readonly symbol: string;
  /** Square edge length in px. Defaults to 30. */
  readonly size?: number;
  /** Palette seed (usually the list index) selecting the gradient. */
  readonly gradientIndex?: number;
  /** Optional explicit gradient `background` value, overriding the palette. */
  readonly background?: string;
  readonly className?: string;
};

/**
 * Renders the emerald-family gradient square used everywhere a token or perp
 * market is listed. Glyph is the uppercased first three chars of the symbol.
 */
export const TokenIcon = ({
  symbol,
  size = 30,
  gradientIndex = 0,
  background,
  className,
}: TokenIconProps): ReactNode => {
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.36),
    background: background ?? iconGradient(gradientIndex),
  };
  return (
    <div className={className === undefined ? "ticon" : `ticon ${className}`} style={style}>
      {symbol.slice(0, 3).toUpperCase()}
    </div>
  );
};
