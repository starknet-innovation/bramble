/**
 * Design-system stylesheet checks for the "Clean Mono" direction: flat solid
 * surfaces (no glass, no aurora, no gradients), press stability, colour-token
 * discipline, hairline/low-elevation structure, and motion accessibility for
 * the side panel UI.
 */
import { describe, expect, test } from "bun:test";
import { SIDEPANEL_STYLES } from "../../src/sidepanel/styles";
import { EASE, MOTION, SHADOW } from "../../src/ui/tokens";

describe("sidepanel styles", () => {
  test("press and hover motion stays inside the lift/scale envelope", () => {
    // Feedback transforms are allowed but bounded: press scales stay within
    // 0.92–1.0 and hover/press lifts within 2px, so controls feel alive
    // without drifting under the pointer. Entrance keyframes are exempt.
    const pressBlocks = [...SIDEPANEL_STYLES.matchAll(/:(?:active|hover)[^{]*\{([^}]*)\}/g)].map(
      (match) => match[1] ?? "",
    );
    const scales = pressBlocks.flatMap((block) =>
      [...block.matchAll(/scale\((0?\.\d+|1)\)/g)].map((match) => Number(match[1])),
    );
    expect(scales.length).toBeGreaterThan(0);
    for (const scale of scales) {
      expect(scale).toBeGreaterThanOrEqual(0.92);
      expect(scale).toBeLessThanOrEqual(1);
    }
    const lifts = pressBlocks.flatMap((block) =>
      [...block.matchAll(/translateY\((-?\d+)px\)/g)].map((match) => Number(match[1])),
    );
    for (const lift of lifts) {
      expect(Math.abs(lift)).toBeLessThanOrEqual(2);
    }
  });

  test("interactive controls are borderless — structure comes from elevation and hairlines", () => {
    // Structure comes from gentle elevation and 1px hairline edges (box-shadow
    // insets), never from strokes: no `border:` shorthand and no non-zero full
    // border widths. The selected-tab indicator must never carry a transform.
    // Per-side dividers (border-top between rows) remain allowed.
    expect(SIDEPANEL_STYLES).not.toMatch(/border:[^;]*solid/);
    expect(SIDEPANEL_STYLES).not.toMatch(/border:\s*\d*[1-9]/);
    expect(SIDEPANEL_STYLES).not.toMatch(/\[aria-selected="true"\][^}]*transform/s);
  });

  test("the visual layer is flat — no gradients, no glass, no aurora residue", () => {
    // Clean Mono is deliberately flat and legible. The redesign removed the
    // Liquid Glass material and the ambient aurora depth layer entirely, so the
    // stylesheet must carry NO gradients, NO backdrop-filter, NO `.glass`
    // surfaces, and NO aurora tokens. Surfaces are solid fills only.
    expect(SIDEPANEL_STYLES).not.toMatch(/gradient/);
    expect(SIDEPANEL_STYLES).not.toMatch(/backdrop-filter/);
    expect(SIDEPANEL_STYLES).not.toMatch(/-webkit-backdrop-filter/);
    expect(SIDEPANEL_STYLES).not.toMatch(/\.glass\b/);
    expect(SIDEPANEL_STYLES).not.toMatch(/--mc-glass/);
    expect(SIDEPANEL_STYLES).not.toMatch(/--mc-aurora/);
    expect(SIDEPANEL_STYLES).not.toMatch(/aurora-drift/);
  });

  test("hairlines are dividers between rows, never rings around surfaces", () => {
    // The de-bordered language: structure comes from grouped fills, inset
    // hairline DIVIDERS, and gentle shadows. The old --mc-edge inset ring is
    // gone from the vocabulary entirely — no surface may draw a border box.
    expect(SIDEPANEL_STYLES).toContain(`--mc-elev-sm: ${SHADOW.sm}`);
    expect(SIDEPANEL_STYLES).toContain(`--mc-elev-md: ${SHADOW.md}`);
    expect(SIDEPANEL_STYLES).not.toContain("--mc-edge");
    expect(SIDEPANEL_STYLES).not.toMatch(/inset 0 0 0 1px/);
    expect(SIDEPANEL_STYLES).toMatch(/\.account-drawer \{[^}]*background: var\(--mc-panel\)/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.request-card \{[^}]*box-shadow: var\(--mc-elev-sm\)/s);
  });

  test("settings and picker rows live in grouped lists with inset dividers", () => {
    // Grouped lists are the structural backbone: one soft container per group
    // of rows (menu, option, address book, group manage), flat transparent
    // rows inside, separation carried by inset hairline dividers.
    expect(SIDEPANEL_STYLES).toMatch(
      /\.menu-list, \.option-list \{[^}]*background: var\(--mc-panel\)/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.menu-row, button\.option-row, a\.menu-row \{[^}]*background: transparent/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(/\.address-book \{[^}]*background: var\(--mc-panel\)/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /\.menu-list > \* \+ \*::before[^{]*\{[^}]*var\(--mc-hairline\)/s,
    );
  });

  test("receipts, disclosures, and the segmented control carry structured content", () => {
    // Facts read as receipt rows (label left, value right, divider between),
    // advanced forms collapse behind native details disclosures, and either/or
    // preferences ride the segmented control — not bordered boxes.
    expect(SIDEPANEL_STYLES).toMatch(/\.receipt \{[^}]*background: var\(--mc-panel\)/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /\.receipt-row \+ \.receipt-row::before \{[^}]*var\(--mc-hairline\)/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(/details\.disclosure \{[^}]*background: var\(--mc-panel\)/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.seg-option\[aria-pressed="true"\] \{[^}]*background: var\(--mc-panel\)/s,
    );
  });

  test("the dock is an anchored full-bleed bottom bar, not a floating card", () => {
    // Navigation reads as structural chrome: a solid panel drawn to the panel
    // edges (fixed, no rounded floating card, no bottom offset), separated from
    // scrolling content by a top hairline plus the softest upward shadow. Its
    // footprint is single-sourced as --mc-dock-h, which the dock-screen scroll
    // clearance and the toast stack both derive from.
    expect(SIDEPANEL_STYLES).toMatch(/\.wallet-dock \{[^}]*background: var\(--mc-panel\)/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.wallet-dock \{[^}]*position: fixed/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.wallet-dock \{[^}]*bottom: 0/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /\.wallet-dock \{[^}]*box-shadow: inset 0 1px 0 var\(--mc-hairline\), var\(--mc-elev-up\)/s,
    );
    expect(SIDEPANEL_STYLES).not.toMatch(/\.wallet-dock \{[^}]*border-radius/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.screen:not\(\.flow\) \{[^}]*var\(--mc-dock-h\)/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.toast-stack \{[^}]*var\(--mc-dock-h\)/s);
  });

  test("reduced motion collapses every lift and press scale", () => {
    const reduced = SIDEPANEL_STYLES.slice(SIDEPANEL_STYLES.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("transition: none");
    expect(reduced).toContain("transform: none");
  });

  test("colors come only from skin tokens, never literals", () => {
    // The stylesheet ships zero colour hex literals: every colour is a skin
    // token referenced through var()/color-mix. The near-mono palette adds a
    // recessed --mc-sunken tier; the single emerald signal is --mc-accent.
    expect(SIDEPANEL_STYLES).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SIDEPANEL_STYLES).toContain("var(--mc-accent)");
    expect(SIDEPANEL_STYLES).toContain("var(--mc-bg)");
    expect(SIDEPANEL_STYLES).toContain("var(--mc-sunken)");
  });

  test("motion uses shared tokens and respects reduced-motion", () => {
    expect(SIDEPANEL_STYLES).toContain(MOTION.ease);
    expect(SIDEPANEL_STYLES).toContain(`${MOTION.pressMs}ms`);
    expect(SIDEPANEL_STYLES).toContain("prefers-reduced-motion");
    expect(SIDEPANEL_STYLES).toContain(":focus-visible");
  });

  test("screens only animate when the scene changes", () => {
    expect(SIDEPANEL_STYLES).toMatch(/\.shell-animate \.screen \{[^}]*animation/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/(?<!-animate )\.screen \{[^}]*animation/s);
  });

  test("strong easing and spring easings reach the stylesheet as tokens", () => {
    // Motion rides strong curves published as custom properties so screens share
    // one source; the springs stay for the drawer/toast gestures. All motion is
    // calm, small, fast (<300ms) — retuned for restraint, but still spring-true.
    expect(SIDEPANEL_STYLES).toContain(`--ease-out: ${EASE.out}`);
    expect(SIDEPANEL_STYLES).toContain(`--ease-drawer: ${EASE.drawer}`);
    expect(SIDEPANEL_STYLES).toContain("--spring-drawer: linear(");
    expect(SIDEPANEL_STYLES).toContain("--spring-default: linear(");
    // Never expose an ease-in curve for UI motion (it delays the first frame).
    expect(SIDEPANEL_STYLES).not.toMatch(/:\s*ease-in\b/);
  });

  test("the single cobalt accent is reserved for signal, not every surface", () => {
    // Restraint check: the accent drives the active dock item, the portfolio tab
    // indicator, and focus — but resting neutral rows/tiles carry a neutral
    // fill, so the accent stays a rare highlight.
    expect(SIDEPANEL_STYLES).toMatch(/\.tab-indicator \{[^}]*background: var\(--mc-accent\)/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.nav-item\[aria-selected="true"\] \{ color: var\(--mc-accent\)/,
    );
    // The active portfolio tab (Tokens/Collectibles/Activity) reads as selected
    // via accent TEXT plus the underline indicator — a flat text tab, never a
    // pill/box. So the active home-tab declares the accent colour and NO home-tab
    // rule paints a background fill.
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.home-tab\[aria-selected="true"\] \{ color: var\(--mc-accent\)/,
    );
    expect(SIDEPANEL_STYLES).not.toMatch(
      /button\.home-tab\[aria-selected="true"\][^}]*background:(?! transparent)/,
    );
    // The token glyph chip is neutral, not accent-filled.
    expect(SIDEPANEL_STYLES).toMatch(/\.token-mark \{[^}]*background: var\(--mc-sunken\)/s);
  });

  test("market and status semantics ride --mc-positive/--mc-danger, never the brand accent", () => {
    // Gains, success, and sparkline direction are meaning, not brand: they read
    // green/red from the semantic tokens so the accent can change hue without
    // ever recoloring a market signal.
    expect(SIDEPANEL_STYLES).toContain(".token-change.up { color: var(--mc-positive); }");
    expect(SIDEPANEL_STYLES).toContain(".tx-status.accepted { color: var(--mc-positive); }");
    expect(SIDEPANEL_STYLES).toContain(".sparkline-up polyline { stroke: var(--mc-positive); }");
    // Toast tone is a leading icon chip — green check on positive-soft for
    // success, red alert on danger-soft for error — a fixed heuristic the eye
    // reads before any text, while the surface stays a neutral panel.
    expect(SIDEPANEL_STYLES).toContain(
      ".toast.success .toast-icon { background: var(--mc-positive-soft); color: var(--mc-positive); }",
    );
    expect(SIDEPANEL_STYLES).toContain(
      ".toast.error .toast-icon { background: var(--mc-danger-soft); color: var(--mc-danger); }",
    );
    // The swap success moment draws its ring and check in the semantic green
    // and collapses to static marks under reduced motion.
    expect(SIDEPANEL_STYLES).toMatch(/\.swap-success-ring \{[^}]*animation: swap-draw/s);
    const reducedBlock = SIDEPANEL_STYLES.slice(SIDEPANEL_STYLES.indexOf("prefers-reduced-motion"));
    expect(reducedBlock).toContain(".swap-success-ring, .swap-success-check");
    // The pending-count badge ink is the page ground, never the accent's paired
    // text colour (which tracks the accent, not the danger fill).
    expect(SIDEPANEL_STYLES).toMatch(/\.badge \{[^}]*color: var\(--mc-bg\)/s);
  });

  test("focus is one consistent accent ring declared once", () => {
    // A single focus system: one generic ring (offset halo) plus a hugging
    // inner ring on filled fields. No other layer may redeclare the outline.
    const rings = [...SIDEPANEL_STYLES.matchAll(/outline: 2px solid var\(--mc-accent\)/g)];
    expect(rings.length).toBe(1);
    expect(SIDEPANEL_STYLES).toContain(
      ":focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }",
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /input:focus-visible, select:focus-visible, textarea:focus-visible \{[^}]*outline-offset: -2px/s,
    );
  });

  test("hover feedback is gated to fine pointers", () => {
    // Touch fires a phantom :hover on tap; surface-fill hovers must live inside
    // (hover: hover) media blocks so a tap never strands a highlighted row.
    const gates = [...SIDEPANEL_STYLES.matchAll(/@media \(hover: hover\) and \(pointer: fine\)/g)];
    expect(gates.length).toBeGreaterThanOrEqual(8);
    // Selected controls keep their accent-soft fill under the pointer — the
    // pressed-state hover rules exist so hovering never visually deselects.
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.group-chip\[aria-pressed="true"\]:not\(:disabled\):hover \{ background: var\(--mc-accent-soft\)/,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.account-check\[aria-pressed="true"\]:not\(:disabled\):hover \{ background: var\(--mc-accent-soft\)/,
    );
    // Same guarantee for accent-ink selection: hovering the active dock item
    // or portfolio tab must never strip its accent back to plain text.
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.nav-item\[aria-selected="true"\]:not\(:disabled\):hover \{ color: var\(--mc-accent\)/,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.home-tab\[aria-selected="true"\]:not\(:disabled\):hover \{ color: var\(--mc-accent\)/,
    );
  });

  test("home action tiles are borderless icons, not boxes", () => {
    // The client asked the Send/Receive row (formerly Send/Receive/NFTs, before
    // the redundant NFTs tile was dropped) to read as plain icons with labels
    // beneath, so the tile box treatment is gone: the resting tile has a
    // transparent fill and carries no hairline edge, no elevation shadow, and no
    // boxy fixed min-height. Primary (Send) stays distinguishable through an
    // accent-tinted ICON, never a filled accent box.
    expect(SIDEPANEL_STYLES).toMatch(/button\.action-tile \{[^}]*background: transparent/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/button\.action-tile \{[^}]*box-shadow/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/button\.action-tile \{[^}]*min-height/s);
    // No filled primary box — the accent lives on the icon only.
    expect(SIDEPANEL_STYLES).not.toMatch(/button\.action-tile\.primary \{/);
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.action-tile\.primary \.tile-icon \{ color: var\(--mc-accent\)/,
    );
  });

  test("the active dock item is an accent icon, never a background pill", () => {
    // The dock highlights the active/focused item by tinting the icon itself
    // emerald (inactive stays muted) — there is NO filled background highlight
    // behind it and NO moving indicator pill. So the active nav-item declares a
    // colour but no background, and the icon holder never paints a fill.
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.nav-item\[aria-selected="true"\] \{ color: var\(--mc-accent\)/,
    );
    expect(SIDEPANEL_STYLES).not.toMatch(/button\.nav-item\[aria-selected="true"\][^}]*background/);
    expect(SIDEPANEL_STYLES).not.toMatch(/\.tab-icon[^{}]*\{[^}]*background/s);
  });

  test("view transitions are direction-aware and reduced-motion safe", () => {
    expect(SIDEPANEL_STYLES).toContain(
      'html[data-nav-direction="forward"]::view-transition-new(root)',
    );
    expect(SIDEPANEL_STYLES).toContain(
      'html[data-nav-direction="back"]::view-transition-old(root)',
    );
    expect(SIDEPANEL_STYLES).toContain(
      'html[data-nav-direction="swap"]::view-transition-new(root)',
    );
    // Transition motion collapses to a cut under reduced motion.
    expect(SIDEPANEL_STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-old\(root\)[^}]*animation: none/s,
    );
  });
});
