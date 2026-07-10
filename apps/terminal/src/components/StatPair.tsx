/**
 * StatPair — an uppercase label above a value, the unit used throughout the
 * mockup's `.statgrid`, `.miniStats`, and balance rows.
 */
import type { ReactNode } from "react";

export type StatPairProps = {
  readonly label: ReactNode;
  readonly value: ReactNode;
  /** Visual density. `stat` = statgrid cell (default); `mini` = miniStats cell. */
  readonly variant?: "stat" | "mini";
  /** Tone applied to the value (adds `pos`/`neg`). */
  readonly tone?: "pos" | "neg";
};

/**
 * Renders a label/value stat cell. Wrap several in a `.statgrid` or `.miniStats`
 * fl/ex container to reproduce the mockup's stat rows.
 */
export const StatPair = ({ label, value, variant = "stat", tone }: StatPairProps): ReactNode => {
  if (variant === "mini") {
    return (
      <div className="m">
        <div className="l">{label}</div>
        <div className={tone === undefined ? "v" : `v ${tone}`}>{value}</div>
      </div>
    );
  }
  return (
    <div className="s">
      <div className="l">{label}</div>
      <div className={tone === undefined ? "v" : `v ${tone}`}>{value}</div>
    </div>
  );
};
