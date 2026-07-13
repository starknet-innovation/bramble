/**
 * Card / Panel — the mockup `.card` surface with an optional `.card-h` header.
 */
import type { CSSProperties, ReactNode } from "react";

export type CardProps = {
  /** Header title text; when set, a `.card-h` header row is rendered. */
  readonly title?: ReactNode;
  /** Content pinned to the right of the header (e.g. a dropdown / filter). */
  readonly headerRight?: ReactNode;
  /** Extra content in the header, after the title (before headerRight). */
  readonly headerExtra?: ReactNode;
  /** Extra class names appended to `card`. */
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
};

/**
 * A bordered surface panel. Pass `title` to get the standard header row; the
 * body is whatever children you provide.
 */
export const Card = ({
  title,
  headerRight,
  headerExtra,
  className,
  style,
  children,
}: CardProps): ReactNode => (
  <div className={className === undefined ? "card" : `card ${className}`} style={style}>
    {title !== undefined && (
      <div className="card-h">
        <span>{title}</span>
        {headerExtra}
        {headerRight !== undefined && <div style={{ marginLeft: "auto" }}>{headerRight}</div>}
      </div>
    )}
    {children}
  </div>
);
