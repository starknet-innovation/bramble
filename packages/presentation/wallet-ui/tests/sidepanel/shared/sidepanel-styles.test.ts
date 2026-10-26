/**
 * Design-system stylesheet checks for the "Clean Mono" direction: flat solid
 * surfaces (no glass, no aurora, no gradients), press stability, colour-token
 * discipline, hairline/low-elevation structure, and motion accessibility for
 * the side panel UI.
 */
import { describe, expect, test } from "bun:test";
import { CONTROL, EASE, MOTION, RADIUS, SHADOW, SIZE } from "@bramble/ui-kit/tokens";
import { SIDEPANEL_STYLES } from "../../../src/sidepanel/styles/index";

describe("sidepanel styles", () => {
  test("press and hover motion stays inside the lift/scale envelope", () => {
    // Feedback transforms are allowed but bounded: press scales stay within
    // 0.95–1.0 and hover/press lifts within 2px, so controls feel alive
    // without drifting under the pointer. Entrance keyframes are exempt.
    const pressBlocks = [...SIDEPANEL_STYLES.matchAll(/:(?:active|hover)[^{]*\{([^}]*)\}/g)].map(
      (match) => match[1] ?? "",
    );
    const scales = pressBlocks.flatMap((block) =>
      [...block.matchAll(/scale\((0?\.\d+|1)\)/g)].map((match) => Number(match[1])),
    );
    expect(scales.length).toBeGreaterThan(0);
    for (const scale of scales) {
      expect(scale).toBeGreaterThanOrEqual(0.95);
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
    // Fields are the one control whose fill cannot identify it (elevated sits
    // within 1.1:1 of the panel), so they carry a per-side edge — a bottom
    // stroke in the tested field-edge token — never a ring (spec item 25).
    expect(SIDEPANEL_STYLES).toMatch(
      /input, select, textarea \{[^}]*border-bottom: 1px solid var\(--bramble-border\)/s,
    );
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
    expect(SIDEPANEL_STYLES).not.toMatch(/--bramble-glass/);
    expect(SIDEPANEL_STYLES).not.toMatch(/--bramble-aurora/);
    expect(SIDEPANEL_STYLES).not.toMatch(/aurora-drift/);
  });

  test("hairlines are dividers between rows, never rings around surfaces", () => {
    // The de-bordered language: structure comes from grouped fills, inset
    // hairline DIVIDERS, and gentle shadows. The old --bramble-edge inset ring is
    // gone from the vocabulary entirely — no surface may draw a border box.
    expect(SIDEPANEL_STYLES).toContain(`--bramble-elev-sm: ${SHADOW.sm}`);
    expect(SIDEPANEL_STYLES).toContain(`--bramble-elev-md: ${SHADOW.md}`);
    expect(SIDEPANEL_STYLES).not.toContain("--bramble-edge");
    expect(SIDEPANEL_STYLES).not.toMatch(/inset 0 0 0 1px/);
    expect(SIDEPANEL_STYLES).toMatch(/\.account-drawer \{[^}]*background: var\(--bramble-panel\)/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.request-card \{[^}]*box-shadow: var\(--bramble-elev-sm\)/s);
  });

  test("settings and picker rows live in grouped lists with inset dividers", () => {
    // Grouped lists are the structural backbone: one soft container per group
    // of rows (menu, option, address book, group manage), flat transparent
    // rows inside, separation carried by inset hairline dividers.
    expect(SIDEPANEL_STYLES).toMatch(
      /\.menu-list, \.option-list \{[^}]*background: var\(--bramble-panel\)/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.menu-row, button\.option-row, a\.menu-row \{[^}]*background: transparent/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(/\.address-book \{[^}]*background: var\(--bramble-panel\)/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /\.menu-list > \* \+ \*::before[^{]*\{[^}]*var\(--bramble-hairline\)/s,
    );
  });

  test("the send rail sizes itself from its own steps", () => {
    // A pinned column count outlived the steps it was written for and left an
    // empty column, which read as the rail sitting off to one side.
    expect(SIDEPANEL_STYLES).toMatch(/\.send-progress \{[^}]*grid-auto-flow: column/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/\.send-progress \{[^}]*grid-template-columns/s);
  });

  test("receipts, disclosures, and the segmented control carry structured content", () => {
    // Facts read as receipt rows (label left, value right, divider between),
    // advanced forms collapse behind native details disclosures, and either/or
    // preferences ride the segmented control — not bordered boxes.
    expect(SIDEPANEL_STYLES).toMatch(/\.receipt \{[^}]*background: var\(--bramble-panel\)/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /\.receipt-row \+ \.receipt-row::before \{[^}]*var\(--bramble-hairline\)/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /details\.disclosure \{[^}]*background: var\(--bramble-panel\)/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.seg-option\[aria-pressed="true"\] \{[^}]*background: var\(--bramble-panel\)/s,
    );
  });

  test("the NFT detail hero keeps a gallery-scale square instead of shrink-wrapping", () => {
    expect(SIDEPANEL_STYLES).toMatch(/\.nft-hero \{[^}]*max-width: 240px;[^}]*width: 100%;/s);
  });

  test("the dock is a floating pill centred above the panel edge", () => {
    // Navigation floats as one rounded pill: fixed, lifted off the bottom
    // edge by a token gap, centred by auto margins at its content width, and
    // separated from scrolling content by the floating-chrome elevation alone
    // (no ring, no top hairline). Its footprint from the bottom edge is
    // single-sourced as --bramble-dock-h, which the dock-screen scroll
    // clearance and the toast stack both derive from.
    expect(SIDEPANEL_STYLES).toMatch(/\.wallet-dock \{[^}]*background: var\(--bramble-panel\)/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.wallet-dock \{[^}]*border-radius: 999px/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.wallet-dock \{[^}]*bottom: 16px/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.wallet-dock \{[^}]*box-shadow: var\(--bramble-elev-md\)/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.wallet-dock \{[^}]*margin: 0 auto/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.wallet-dock \{[^}]*position: fixed/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.wallet-dock \{[^}]*width: max-content/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/\.wallet-dock \{[^}]*hairline/s);
    // The selected root sits on the accent's soft tint with accent ink.
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.nav-item\[aria-selected="true"\] \{ background: var\(--bramble-accent-soft\); color: var\(--bramble-accent\); \}/,
    );
    expect(SIDEPANEL_STYLES).toContain("--bramble-dock-h: calc(44px + 6px * 2 + 16px)");
    expect(SIDEPANEL_STYLES).toMatch(/\.screen:not\(\.flow\) \{[^}]*var\(--bramble-dock-h\)/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.toast-stack \{[^}]*var\(--bramble-dock-h\)/s);
  });

  test("reduced motion collapses every lift and press scale", () => {
    const reduced = SIDEPANEL_STYLES.slice(SIDEPANEL_STYLES.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain(".account-net.degraded .dot");
    expect(reduced).toContain("transition: none");
    expect(reduced).toContain("transform: none");
  });

  test("keeps network identity on one line and reserves motion for degraded data", () => {
    expect(SIDEPANEL_STYLES).toMatch(
      /\.account-net \{[^}]*overflow: hidden;[^}]*text-wrap: nowrap;/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /\.account-network-label \{[^}]*text-overflow: ellipsis;[^}]*text-wrap: nowrap;/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /\.pill \{[^}]*max-width: 100%;[^}]*text-overflow: ellipsis;/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /\.account-net\.degraded \.dot \{[^}]*network-status-pulse 2400ms[^}]*var\(--bramble-warning\)/s,
    );
  });

  test("short screens suppress overscroll and activity puts state on the icon", () => {
    expect(SIDEPANEL_STYLES).toMatch(/body \{[^}]*overscroll-behavior-y: none;/s);
    // The document scrolls the approval takeover; a contained list would trap the wheel.
    expect(SIDEPANEL_STYLES).not.toMatch(/\.request-list \{[^}]*overscroll-behavior/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.activity-head h1 \{[^}]*font-size: 22px;/s);
    expect(SIDEPANEL_STYLES).toContain(
      ".tx-kind-icon.accepted { color: var(--bramble-positive); }",
    );
    expect(SIDEPANEL_STYLES).toContain(".tx-kind-icon.pending { color: var(--bramble-warning); }");
    expect(SIDEPANEL_STYLES).not.toContain(".tx-status");
  });

  test("participant choices retain their labels at minimum side-panel width", () => {
    expect(SIDEPANEL_STYLES).toMatch(
      /@media \(max-width: 390px\) \{[^}]*\.multisig-participant-methods button \{ padding-inline:/s,
    );
  });

  test("the send amount card cannot be widened by a balance line written after first paint", () => {
    // The balance label is rewritten by the bucket controls and by every
    // repaint. A flex item that could not shrink below its longest figure once
    // grew the row, the card, and the whole details stage past a 320px panel;
    // the shortcuts hold their size and drop to their own line instead.
    expect(SIDEPANEL_STYLES).toMatch(/\.send-amount-meta \{[^}]*flex-wrap: wrap;/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /\.send-amount-meta > span:first-child \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /\.send-amount-shortcuts \{[^}]*flex: none;[^}]*margin-left: auto;/s,
    );
    // The account identity beside each route toggle clips a long single-word
    // name rather than pushing the receipt out of the panel.
    expect(SIDEPANEL_STYLES).toMatch(/\.send-context-account \{[^}]*min-width: 0;/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /\.send-context-account strong,\s*\.send-context-account code \{[^}]*max-width: 100%;[^}]*text-overflow: ellipsis;[^}]*text-wrap: nowrap;/s,
    );
  });

  test("compact disclosure states cannot collide with their titles", () => {
    expect(SIDEPANEL_STYLES).toMatch(
      /details\.disclosure > summary \.menu-copy strong \{[^}]*text-overflow: ellipsis;[^}]*text-wrap: nowrap;/s,
    );
    expect(SIDEPANEL_STYLES).toContain("details.disclosure > summary .menu-value { flex: none; }");
  });

  test("colors come only from skin tokens, never literals", () => {
    // The stylesheet ships zero colour hex literals: every colour is a skin
    // token referenced through var()/color-mix. The near-mono palette adds a
    // recessed --bramble-sunken tier; green/red are semantic tokens only.
    expect(SIDEPANEL_STYLES).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SIDEPANEL_STYLES).toContain("var(--bramble-accent)");
    expect(SIDEPANEL_STYLES).toContain("var(--bramble-bg)");
    expect(SIDEPANEL_STYLES).toContain("var(--bramble-sunken)");
  });

  test("motion uses shared tokens and respects reduced-motion", () => {
    expect(SIDEPANEL_STYLES).toContain(MOTION.ease);
    expect(SIDEPANEL_STYLES).toContain(`${MOTION.pressMs}ms`);
    expect(SIDEPANEL_STYLES).toContain(`liquid-dot-left ${MOTION.waitLoopMs}ms`);
    // The welcome card is still: no orbit, pulse, or other decorative motion.
    expect(SIDEPANEL_STYLES).not.toContain("onboarding-track-orbit");
    expect(SIDEPANEL_STYLES).not.toContain("onboarding-concentric-pulse");
    expect(SIDEPANEL_STYLES).not.toContain("@keyframes journey-spin");
    expect(SIDEPANEL_STYLES).not.toContain("@keyframes send-spin");
    expect(SIDEPANEL_STYLES).toContain("prefers-reduced-motion");
    expect(SIDEPANEL_STYLES).toContain(":focus-visible");
  });

  test("a busy Review button shows the shared Liquid Dots mark, never a spinner", () => {
    // The wait behind Review (a proof, a relay quote, a fee estimate) reuses the
    // one indeterminate treatment the wallet has: the compact mark inside the
    // button is hidden until the binding marks it busy, and the send glyph
    // steps aside for it. No rotating icon is introduced for this button.
    expect(SIDEPANEL_STYLES).toMatch(/#send-review-button \.liquid-dots \{ display: none; \}/);
    expect(SIDEPANEL_STYLES).toMatch(
      /#send-review-button\[data-busy\] \.liquid-dots \{ display: inline-flex; \}/,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /#send-review-button\[data-busy\] > \.icon \{ display: none; \}/,
    );
    expect(SIDEPANEL_STYLES).not.toMatch(/#send-review-button\[data-busy\][^{]*\{[^}]*animation/);
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

  test("neutral action emphasis is reserved for signal, not every surface", () => {
    // The dock marks its selected root with the accent's soft tint — the same
    // selection language as group chips — and nothing else in the dock carries
    // a container; Portfolio tabs use text contrast alone, no underline.
    expect(SIDEPANEL_STYLES).not.toContain(".tab-indicator");
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.nav-item\[aria-selected="true"\] \{ background: var\(--bramble-accent-soft\); color: var\(--bramble-accent\); \}/,
    );
    expect(SIDEPANEL_STYLES).toMatch(/button\.nav-item \{[^}]*background: transparent/s);
    // The active Portfolio tab is plain high-contrast text, never a pill.
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.home-tab\[aria-selected="true"\] \{ color: var\(--bramble-text\)/,
    );
    expect(SIDEPANEL_STYLES).not.toMatch(
      /button\.home-tab\[aria-selected="true"\][^}]*background:(?! transparent)/,
    );
    // The token glyph chip is neutral, not accent-filled.
    expect(SIDEPANEL_STYLES).toMatch(/\.token-mark \{[^}]*background: var\(--bramble-sunken\)/s);
  });

  test("market and status semantics ride --bramble-positive/--bramble-danger, never action emphasis", () => {
    // Gains, success, and sparkline direction are meaning, not decoration:
    // they read green/red from the semantic tokens.
    expect(SIDEPANEL_STYLES).toContain(".token-change.up { color: var(--bramble-positive); }");
    expect(SIDEPANEL_STYLES).toContain(
      ".tx-kind-icon.accepted { color: var(--bramble-positive); }",
    );
    expect(SIDEPANEL_STYLES).toContain(
      ".sparkline-up polyline { stroke: var(--bramble-positive); }",
    );
    // Toast tone is a leading icon chip — green check on positive-soft for
    // success, red alert on danger-soft for error — a fixed heuristic the eye
    // reads before any text, while the surface stays a neutral panel and long
    // messages wrap instead of clipping their recovery guidance.
    expect(SIDEPANEL_STYLES).toContain(
      ".toast.success .toast-icon { background: var(--bramble-positive-soft); color: var(--bramble-positive); }",
    );
    expect(SIDEPANEL_STYLES).toContain(
      ".toast.error .toast-icon { background: var(--bramble-danger-soft); color: var(--bramble-danger); }",
    );
    // An unknown outcome is amber, never the danger chip (issue 382).
    expect(SIDEPANEL_STYLES).toContain(
      ".toast.warning .toast-icon { background: var(--bramble-warning-soft); color: var(--bramble-warning); }",
    );
    expect(SIDEPANEL_STYLES).toContain("--bramble-warning-soft: color-mix(");
    expect(SIDEPANEL_STYLES).toMatch(
      /\.toast-text \{[^}]*overflow-wrap: anywhere[^}]*text-wrap: pretty/s,
    );
    // Send and Swap end on one outcome component, so the success mark is
    // defined once: it draws in the semantic green and collapses to a static
    // mark under reduced motion. Swap had its own copy, and the two drifted.
    expect(SIDEPANEL_STYLES).toMatch(/\.send-success-ring \{[^}]*animation: send-draw/s);
    expect(SIDEPANEL_STYLES).not.toContain("swap-draw");
    const reducedBlock = SIDEPANEL_STYLES.slice(SIDEPANEL_STYLES.indexOf("prefers-reduced-motion"));
    expect(reducedBlock).toContain(".send-success-ring, .send-success-check");
    // The pending-count badge ink is the page ground, never the accent's paired
    // text colour (which tracks the accent, not the danger fill).
    expect(SIDEPANEL_STYLES).toMatch(/\.badge \{[^}]*color: var\(--bramble-bg\)/s);
  });

  test("focus is one consistent softened ring declared once", () => {
    // A single focus system: one generic ring (offset halo) plus a hugging
    // inner ring on filled fields. No other layer may redeclare the outline.
    const rings = [...SIDEPANEL_STYLES.matchAll(/outline: 2px solid var\(--bramble-focus-ring\)/g)];
    expect(rings.length).toBe(1);
    expect(SIDEPANEL_STYLES).toContain(
      "--bramble-focus-ring: color-mix(in srgb, var(--bramble-accent) 72%, var(--bramble-bg));",
    );
    expect(SIDEPANEL_STYLES).toContain(
      ":focus-visible { outline: 2px solid var(--bramble-focus-ring); outline-offset: 2px; }",
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /input:focus-visible, select:focus-visible, textarea:focus-visible \{[^}]*outline-offset: -2px/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /\.send-recipient-row:focus-visible,\s*\.send-asset-row:focus-visible \{[^}]*outline-offset: -2px/s,
    );
  });

  test("hover feedback is gated to fine pointers", () => {
    // Touch fires a phantom :hover on tap; surface-fill hovers must live inside
    // (hover: hover) media blocks so a tap never strands a highlighted row.
    const gates = [...SIDEPANEL_STYLES.matchAll(/@media \(hover: hover\) and \(pointer: fine\)/g)];
    expect(gates.length).toBeGreaterThanOrEqual(8);
    // The generic primary feedback is deliberately zero-specificity. Otherwise
    // it can outrank neutral component rows and produce accent-text on an
    // accent background (white-on-white in the default dark skin).
    expect(SIDEPANEL_STYLES).toContain(
      ":where(button:not(:disabled):hover) { background: var(--bramble-accent-hover); }",
    );
    expect(SIDEPANEL_STYLES).toContain(
      ":where(button:not(:disabled):active), a.icon-button:active",
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.add-account-option:not\(:disabled\):hover \{[^}]*background: var\(--bramble-hover\);[^}]*color: var\(--bramble-text\)/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.add-account-option\[aria-pressed="true"\]:not\(:disabled\):hover \{[^}]*background: var\(--bramble-elevated\);[^}]*color: var\(--bramble-text\)/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.onboarding-inline-action:not\(:disabled\):hover \{[^}]*background: var\(--bramble-hover\);[^}]*color: var\(--bramble-text\)/s,
    );
    // Selected controls keep their accent-soft fill under the pointer — the
    // pressed-state hover rules exist so hovering never visually deselects.
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.group-chip\[aria-pressed="true"\]:not\(:disabled\):hover \{ background: var\(--bramble-accent-soft\)/,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.account-check\[aria-pressed="true"\]:not\(:disabled\):hover \{ background: var\(--bramble-accent-soft\)/,
    );
    // Hovering the selected dock root keeps its tinted disc and accent ink.
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.nav-item\[aria-selected="true"\]:not\(:disabled\):hover \{ background: var\(--bramble-accent-soft\); color: var\(--bramble-accent\); \}/,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.home-tab\[aria-selected="true"\]:not\(:disabled\):hover \{ color: var\(--bramble-text\)/,
    );
    // Non-primary Send and multisig controls must never inherit the generic
    // high-contrast CTA fill, which can produce white-on-white rows in dark
    // mode. Their more-specific selectors preserve neutral surfaces and ink.
    expect(SIDEPANEL_STYLES).toMatch(
      /\.send-recipient-row:not\(:disabled\):hover,\s*\.send-asset-row:not\(:disabled\):hover \{[^}]*background: var\(--bramble-hover\);[^}]*color: var\(--bramble-text\)/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /\.send-token-trigger:not\(:disabled\):hover \{[^}]*background: var\(--bramble-hover\);[^}]*color: var\(--bramble-text\)/s,
    );
  });

  test("home action tiles are four equal width-filling tools", () => {
    expect(SIDEPANEL_STYLES).toMatch(
      /\.action-row \{[^}]*grid-auto-columns: minmax\(0, 1fr\);[^}]*grid-auto-flow: column/s,
    );
    // Tiles wear the dock's selected-root treatment: the accent's soft tint
    // with accent ink on both glyph and caption, flat — no shadow. Hover and
    // press deepen the tint on-family (more accent over the soft tint) and
    // never fall back to the neutral hover / press fills.
    expect(SIDEPANEL_STYLES).toMatch(
      /\.action-tile \{[^}]*background: var\(--bramble-accent-soft\);[^}]*color: var\(--bramble-accent\);/s,
    );
    expect(SIDEPANEL_STYLES).not.toMatch(/\.action-tile \{[^}]*box-shadow/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.tile-icon \{[^}]*color: var\(--bramble-accent\);/s);
    expect(SIDEPANEL_STYLES).toMatch(/\.tile-label \{[^}]*color: var\(--bramble-accent\);/s);
    expect(SIDEPANEL_STYLES).toMatch(
      /\.action-tile:not\(:disabled\):hover \{[^}]*background: color-mix\(in srgb, var\(--bramble-accent\) \d+%, var\(--bramble-accent-soft\)\)/s,
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /\.action-tile:not\(:disabled\):active \{[^}]*background: color-mix\(in srgb, var\(--bramble-accent\) \d+%, var\(--bramble-accent-soft\)\)/s,
    );
    expect(SIDEPANEL_STYLES).not.toMatch(/\.action-tile[^{]*\{[^}]*var\(--bramble-hover\)/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/\.action-tile[^{]*\{[^}]*var\(--bramble-soft-press\)/s);
    expect(SIDEPANEL_STYLES).not.toMatch(/\.tile-label[^{]*\{[^}]*var\(--bramble-muted\)/s);
    expect(SIDEPANEL_STYLES).toMatch(
      new RegExp(`\\.action-tile \\{[^}]*border-radius: ${RADIUS.lg}`, "s"),
    );
    expect(SIDEPANEL_STYLES).toMatch(
      new RegExp(`\\.action-tile \\{[^}]*min-height: ${SIZE.actionTile}`, "s"),
    );
    expect(SIZE.actionTile).toBe("72px");
    expect(SIDEPANEL_STYLES).toMatch(
      new RegExp(`\\.tile-icon \\.icon \\{[^}]*height: ${CONTROL.majorIcon}`, "s"),
    );
    expect(CONTROL.majorIcon).toBe("22.5px");
    expect(SIDEPANEL_STYLES).not.toContain(".action-tile.primary");
  });

  test("the retired Terminal card leaves no orphan styles behind", () => {
    expect(SIDEPANEL_STYLES).not.toContain("terminal-cta");
  });

  test("the labelled dock carries state on the root capsule, never on the glyph", () => {
    // Roots are 44px-tall capsules: muted ink at rest, text ink on hover, and
    // the selected root on the accent's soft tint. Each root shows a visible
    // caption under the glyph; the glyph wrapper itself never gains a surface.
    expect(SIDEPANEL_STYLES).toMatch(
      /button\.nav-item \{[^}]*color: var\(--bramble-muted\)[^}]*height: 44px[^}]*min-width: 44px/s,
    );
    expect(SIDEPANEL_STYLES).not.toMatch(/button\.nav-item\[aria-selected="true"\][^}]*box-shadow/);
    expect(SIDEPANEL_STYLES).toMatch(/\.nav-label \{[^}]*font-size: 12px/s);
    expect(SIDEPANEL_STYLES).not.toContain(".nav-tooltip");
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

  test("onboarding transitions only the stable stage in both directions", () => {
    expect(SIDEPANEL_STYLES).toContain("view-transition-name: onboarding-stage");
    expect(SIDEPANEL_STYLES).toContain(
      'html[data-onboarding-direction="forward"]::view-transition-new(onboarding-stage)',
    );
    expect(SIDEPANEL_STYLES).toContain(
      'html[data-onboarding-direction="back"]::view-transition-old(onboarding-stage)',
    );
    expect(SIDEPANEL_STYLES).toMatch(
      /\.onboarding-wizard > \.onboarding-step \{[^}]*position: absolute/s,
    );
    expect(SIDEPANEL_STYLES).toContain("button.onboarding-option:not(:disabled):hover");
  });

  test("the onboarding lockup scales with the card, not the viewport", () => {
    expect(SIDEPANEL_STYLES).toMatch(
      /\.onboarding-lockup \.brand-wordmark \{[^}]*width: min\(60%, 220px\)/s,
    );
  });

  test("the selected onboarding contract keeps readable supporting copy", () => {
    expect(SIDEPANEL_STYLES).toMatch(
      /\.onboarding-contract\[aria-pressed="true"\] \.onboarding-contract-copy > span:last-child \{\s*color: var\(--bramble-text\)/,
    );
  });
  test("the document reserves its scrollbar gutter so an expanding row cannot shift the layout", () => {
    // `.shell` is min-height: 100vh and nothing between it and the viewport
    // scrolls, so the document is the scroll container. Expanding a token row
    // (<details>) summons the document scrollbar, and without a reserved gutter
    // it takes its width from the content box — every element reflows narrower
    // and the screen appears to shift sideways. Regression guard for #384.
    expect(SIDEPANEL_STYLES).toMatch(/html \{[^}]*scrollbar-gutter: stable/s);
  });
});
