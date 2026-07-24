/**
 * AVNU-backed token artwork with a deterministic ticker fallback.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { iconColor } from "./palette";

export type TokenIconProps = {
  /** Symbol; the first three characters are used only when artwork fails. */
  readonly symbol: string;
  /** Canonical artwork URL from the token metadata provider. */
  readonly logoUri?: string | null;
  /** Human-readable token name used in the image title. */
  readonly name?: string;
  /** Square edge length in px. Defaults to 30. */
  readonly size?: number;
  /** Palette seed (usually the list index) selecting the solid color. */
  readonly colorIndex?: number;
  /** Optional explicit background color, overriding the palette. */
  readonly color?: string;
  readonly className?: string;
};

/**
 * Renders canonical token artwork when available. Unavailable or broken remote
 * artwork fails soft to the existing ticker tile without leaving a broken image.
 */
export const TokenIcon = ({
  symbol,
  logoUri = null,
  name,
  size = 30,
  colorIndex = 0,
  color,
  className,
}: TokenIconProps): ReactNode => {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const usableLogo = logoUri?.trim() ?? "";
  const showLogo = usableLogo !== "" && failedUri !== usableLogo;
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.36),
    background: color ?? iconColor(colorIndex),
  };
  return (
    <div
      className={className === undefined ? "ticon" : `ticon ${className}`}
      style={style}
      title={name ?? symbol}
    >
      {showLogo ? (
        <img
          alt=""
          decoding="async"
          loading="lazy"
          onError={() => setFailedUri(usableLogo)}
          referrerPolicy="no-referrer"
          src={usableLogo}
        />
      ) : (
        symbol.slice(0, 3).toUpperCase()
      )}
    </div>
  );
};
