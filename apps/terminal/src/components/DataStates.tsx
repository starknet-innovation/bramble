/**
 * Shared loading / error presentational helpers for the data-driven screens: a
 * shimmer skeleton row list shown while a hook's initial fetch is in flight, and
 * a non-blocking error banner shown when a fetch fails. These keep the
 * loading/error affordances consistent across Discover / Tokens / Perps /
 * Portfolio.
 */
import type { CSSProperties, ReactNode } from "react";

/** A list of shimmer rows approximating a token / market list while loading. */
export const SkeletonRows = ({
  rows = 6,
  style,
}: {
  readonly rows?: number;
  readonly style?: CSSProperties;
}): ReactNode => (
  <div style={style} aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_unused, index) => (
      <div className="skel-row" key={index}>
        <div className="skeleton skel-avatar" />
        <div className="skel-fill">
          <div className="skeleton skel-line" style={{ width: "60%" }} />
          <div className="skeleton skel-line" style={{ width: "40%" }} />
        </div>
      </div>
    ))}
  </div>
);

/** A full-width chart-sized shimmer block while candles load. */
export const SkeletonChart = ({ height = 320 }: { readonly height?: number }): ReactNode => (
  <div className="skeleton skel-chart" style={{ height }} aria-busy="true" aria-label="Loading chart" />
);

/** A dismissable-looking (non-blocking) error banner. */
export const ErrorBanner = ({ message }: { readonly message: string }): ReactNode => (
  <div className="errbanner" role="alert">
    <span>&#9888;</span>
    <span>{message}</span>
  </div>
);
