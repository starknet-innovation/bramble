/**
 * TabStrip — the underline tab row (`.tabstrip .t`) used to switch views inside
 * a panel. Controlled by the parent.
 */
import type { CSSProperties, ReactNode } from "react";

type TabStripItem<T extends string> = {
  readonly value: T;
  readonly label: ReactNode;
};

export type TabStripProps<T extends string> = {
  readonly items: readonly TabStripItem<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
};

/**
 * Renders an underline tab strip. The active tab gets the high-contrast underline.
 */
export const TabStrip = <T extends string>({
  items,
  value,
  onChange,
  className,
  style,
}: TabStripProps<T>): ReactNode => (
  <div className={className === undefined ? "tabstrip" : `tabstrip ${className}`} style={style}>
    {items.map((item) => (
      <button
        type="button"
        key={item.value}
        className={item.value === value ? "t active" : "t"}
        onClick={() => onChange(item.value)}
        aria-pressed={item.value === value}
      >
        {item.label}
      </button>
    ))}
  </div>
);
