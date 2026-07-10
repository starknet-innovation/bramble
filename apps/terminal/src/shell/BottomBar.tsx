/**
 * Bottom status bar — balance readout and footer links. Ported from the
 * mockup's `.bottombar`.
 */
import type { ReactNode } from "react";

/**
 * The application chrome's bottom bar.
 */
export const BottomBar = (): ReactNode => (
  <div className="bottombar">
    <span className="bal">
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--accent)",
          display: "inline-block",
        }}
      />
      Balance $0.00
    </span>
    <div className="right">
      <a href="#terms">Terms</a>
      <a href="#privacy">Privacy</a>
      <a href="#disclosures">Disclosures</a>
      <a href="#help">Help</a>
      <span className="icons">
        <span>&#9855;</span>
        <span>&#9993;</span>
        <span>&#9673;</span>
      </span>
    </div>
  </div>
);
