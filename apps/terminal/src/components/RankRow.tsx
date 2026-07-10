/**
 * RankRow — a single `<tr>` for the ranked tables (`.ranktable`) on Discover.
 * Renders the rank cell, an icon + name cell, then the caller's trailing
 * right-aligned mono value cells. Must be used inside
 * `<table className="ranktable"><tbody>…</tbody></table>`.
 */
import type { ReactNode } from "react";
import { TokenIcon } from "./TokenIcon";

export type RankRowProps = {
  readonly rank: number;
  /** Symbol shown in the icon glyph. */
  readonly symbol: string;
  /** Primary name (n1). */
  readonly name: ReactNode;
  /** Secondary line under the name (n2), e.g. ticker or a leverage pill. */
  readonly subLabel?: ReactNode;
  readonly colorIndex?: number;
  /** Trailing right-aligned cells (already formatted, e.g. price + PctChange). */
  readonly cells: readonly ReactNode[];
  readonly onClick?: () => void;
};

/**
 * A ranked-table row. Rank + name cell are fixed; `cells` are appended as
 * right-aligned `mono` `<td>`s.
 */
export const RankRow = ({
  rank,
  symbol,
  name,
  subLabel,
  colorIndex = 0,
  cells,
  onClick,
}: RankRowProps): ReactNode => (
  <tr onClick={onClick} style={onClick === undefined ? undefined : { cursor: "pointer" }}>
    <td>{rank}</td>
    <td className="name">
      <div className="namecell">
        <TokenIcon symbol={symbol} size={26} colorIndex={colorIndex} />
        <div>
          <div className="n1">{name}</div>
          {subLabel !== undefined && <div className="n2">{subLabel}</div>}
        </div>
      </div>
    </td>
    {cells.map((cell, index) => (
      // Trailing cells are positional and static within a row; index key is fine.
      // biome-ignore lint/suspicious/noArrayIndexKey: positional static cells
      <td key={index} className="mono">
        {cell}
      </td>
    ))}
  </tr>
);
