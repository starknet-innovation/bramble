/**
 * Solid token/perp icon square.
 */
import type { CSSProperties, ReactNode } from "react";
import { iconColor } from "./palette";

export type TokenIconProps = {
  /** Symbol; the first three characters are shown as the glyph. */
  readonly symbol: string;
  /** Square edge length in px. Defaults to 30. */
  readonly size?: number;
  /** Palette seed (usually the list index) selecting the solid color. */
  readonly colorIndex?: number;
  /** Optional explicit background color, overriding the palette. */
  readonly color?: string;
  readonly className?: string;
};

/**
 * Renders the muted solid square used everywhere a token or perp market is
 * listed. Glyph is the uppercased first three chars of the symbol.
 */
export const TokenIcon = ({
  symbol,
  size = 30,
  colorIndex = 0,
  color,
  className,
}: TokenIconProps): ReactNode => {
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.36),
    background: color ?? iconColor(colorIndex),
  };
  return (
    <div className={className === undefined ? "ticon" : `ticon ${className}`} style={style}>
      {symbol.slice(0, 3).toUpperCase()}
    </div>
  );
};
