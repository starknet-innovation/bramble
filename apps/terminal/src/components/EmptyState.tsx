/**
 * EmptyState — the centered icon + message + optional CTA block the mockup uses
 * for disconnected / empty screens.
 */
import type { CSSProperties, ReactNode } from "react";

export type EmptyStateProps = {
  /** Icon (e.g. a lucide-react icon element) shown in the rounded icon tile. */
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** CTA button label; when set with onCta, a `.cta` button renders. */
  readonly ctaLabel?: ReactNode;
  readonly onCta?: () => void;
  /** Disables the CTA (e.g. while connecting). */
  readonly ctaDisabled?: boolean;
  readonly style?: CSSProperties;
};

/**
 * A full-height empty state. Used for "Connect wallet" prompts and empty lists.
 */
export const EmptyState = ({
  icon,
  title,
  subtitle,
  ctaLabel,
  onCta,
  ctaDisabled = false,
  style,
}: EmptyStateProps): ReactNode => (
  <div className="emptystate" style={style}>
    <div className="icn">{icon}</div>
    <div style={{ fontWeight: 600, color: "var(--text-2)" }}>{title}</div>
    {subtitle !== undefined && (
      <div className="tiny" style={{ maxWidth: 240 }}>
        {subtitle}
      </div>
    )}
    {ctaLabel !== undefined && onCta !== undefined && (
      <button type="button" className="cta" onClick={onCta} disabled={ctaDisabled}>
        {ctaLabel}
      </button>
    )}
  </div>
);
