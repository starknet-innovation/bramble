/**
 * The token dropdown's own surface rules: it restores what a plain button
 * inherits, sizes the shared glyph down, and cannot widen the panel it opens in.
 */
import { describe, expect, test } from "bun:test";
import { SIDEPANEL_STYLES } from "@bramble/wallet-ui/lab";

describe("token dropdown styles", () => {
  test("the token dropdown states its own text colour and a compact glyph", () => {
    // A plain <button> takes the primary accent fill AND its text colour. The
    // option row clears the fill, so it has to restore the text colour too —
    // without it the ticker rendered accent-on-panel, which was unreadable.
    expect(SIDEPANEL_STYLES).toMatch(
      /\.token-dropdown-option \{[^}]*background: transparent;[^}]*color: var\(--bramble-text\)/s,
    );
    // The shared glyph is a 40px chip built for list rows; the dropdown sizes
    // it down rather than inheriting a mark taller than its own row text.
    expect(SIDEPANEL_STYLES).toMatch(
      /\.token-dropdown-option \.token-mark, \.token-dropdown-option \.token-logo \{[^}]*height: 20px/s,
    );
    // Reported on Swap: opening the dropdown slid the whole screen left. Its
    // trigger sits at the right of its row, so a panel hung from the left edge
    // overflowed, widened the document, and shifted everything.
    expect(SIDEPANEL_STYLES).toMatch(/\.token-dropdown-panel \{[^}]*max-width: calc\(100vw/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /\.token-dropdown\[data-align="end"\] \.token-dropdown-panel \{[^}]*inset-inline-end: 0/s,
    );
  });
});
