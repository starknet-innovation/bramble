/**
 * SegmentedTabs — the mockup's pill segmented control (`.subtabs` / `.seg`).
 * Controlled: the parent owns the active value.
 */
import type { ReactNode } from "react";

type SegmentedOption<T extends string> = {
  readonly value: T;
  readonly label: ReactNode;
  /** Optional tone for buy/sell segments (adds `buy`/`sell` classes). */
  readonly tone?: "buy" | "sell";
};

export type SegmentedTabsProps<T extends string> = {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** `subtabs` (default, compact) or `seg` (large buy/sell toggle). */
  readonly variant?: "subtabs" | "seg";
  readonly className?: string;
};

/**
 * A segmented button group. `variant="seg"` renders the large buy/sell toggle;
 * `variant="subtabs"` renders the compact Total/Tokens/Perps style pills.
 */
export const SegmentedTabs = <T extends string>({
  options,
  value,
  onChange,
  variant = "subtabs",
  className,
}: SegmentedTabsProps<T>): ReactNode => (
  <div className={className === undefined ? variant : `${variant} ${className}`}>
    {options.map((option) => {
      const classes = [option.tone ?? "", option.value === value ? "active" : ""]
        .filter(Boolean)
        .join(" ");
      return (
        <button
          type="button"
          key={option.value}
          className={classes === "" ? undefined : classes}
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);
