/**
 * Ambient depth + broad Liquid Glass layer for the side panel. Composed LAST in
 * ./styles.ts so its surface material overrides the flat fills declared earlier,
 * and so its own reduced-motion block wins over the aurora drift.
 *
 * TWO JOBS:
 *
 * 1. AMBIENT DEPTH ("the unlock"). A soft aurora of blurred colour blobs is
 *    painted on a fixed, viewport-filling `body::before` behind all content,
 *    with a faint SVG grain on `body::after` to stop the gradients from banding.
 *    Real Liquid Glass only reads when there is colour and light behind it to
 *    refract — a flat background makes `backdrop-filter` invisible. The blobs
 *    are built entirely from skin tokens (`--mc-aurora-1..3` + `--mc-accent`)
 *    via `color-mix`, so each skin gets its own mood (dark = deep/moody, light
 *    = bright/airy) with no colour literals. The blobs drift slowly; the drift
 *    stops under reduced motion, leaving a legible, static frosted look.
 *
 * 2. BROAD GLASS. The hero balance card, action tiles, list rows, form fields,
 *    menu/option rows, callouts and detail panels all opt into the frosted
 *    material so the whole panel reads as layered glass floating over the
 *    aurora — not just the dock and drawer. Each surface is a SINGLE translucent
 *    layer over the aurora (rows are never nested inside a blurred container),
 *    honouring the "one translucent layer at a time" rule so blurs never stack
 *    into mud. Everything degrades to solid panels where `backdrop-filter` is
 *    unsupported and under reduced-transparency / more-contrast, exactly like
 *    the base `.glass` material.
 *
 * Backdrop sampling note: the aurora lives on `body::before`, so a glass
 * surface only refracts it while no ancestor establishes a transform/filter
 * backdrop-root between them. The scene/panel entrance keyframes are therefore
 * authored to leave NO lingering transform on those container elements (see
 * ./styles-home.ts) — the transform exists only for the ~200ms entrance.
 */
import { RADIUS, SPACE } from "../ui/tokens";

// Surfaces that opt into the frosted material. Each is a lone translucent layer
// directly over the aurora; none is nested inside another blurred surface, so no
// two backdrop-filters ever stack.
const GLASS_SURFACES = [
  ".hero",
  "button.action-tile",
  "li.token-row",
  ".tx-row",
  "button.menu-row",
  "a.menu-row",
  "button.option-row",
  "button.collectible-card",
  ".callout",
  ".field",
  "input[type='text']",
  "input[type='number']",
  "input[type='password']",
  "input[type='search']",
  "input:not([type])",
  "select",
  "textarea",
].join(",\n  ");

// Recessed data panels that frequently sit INSIDE a glass card (the DOMAIN /
// MESSAGE tables inside a sign request, the address under the receive QR). They
// deliberately do NOT take a backdrop-filter: blurring an already-frosted parent
// would stack blurs into mud. Instead they read as a near-solid inset tint with
// a soft recessed shadow — one translucent layer, cleanly nested.
const INSET_PANELS = [".review-panel", ".address-line"].join(",\n  ");

// Every frosted surface, for the shared degradation blocks below.
const ALL_GLASS = `${GLASS_SURFACES},\n  ${INSET_PANELS}`;

// Grain is a desaturated fractal-noise SVG (no colour literals): it breaks the
// smooth gradient banding the aurora would otherwise show on wide flat panels.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E\")";

/**
 * Aurora + broad-glass stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const AURORA_STYLES = `
  /* ---- Ambient depth: aurora blobs + grain behind everything ---- */
  body { position: relative; background: var(--mc-bg); }
  body::before {
    content: "";
    position: fixed;
    inset: -25%;
    z-index: -2;
    pointer-events: none;
    background:
      radial-gradient(40% 36% at 16% 8%, color-mix(in srgb, var(--mc-aurora-1) 70%, transparent), transparent 72%),
      radial-gradient(44% 40% at 88% 4%, color-mix(in srgb, var(--mc-aurora-2) 62%, transparent), transparent 70%),
      radial-gradient(48% 44% at 82% 82%, color-mix(in srgb, var(--mc-aurora-3) 60%, transparent), transparent 72%),
      radial-gradient(42% 42% at 8% 92%, color-mix(in srgb, var(--mc-aurora-1) 52%, transparent), transparent 72%),
      radial-gradient(36% 32% at 50% 46%, color-mix(in srgb, var(--mc-accent) 36%, transparent), transparent 70%),
      var(--mc-bg);
    background-repeat: no-repeat;
    animation: aurora-drift 26s var(--ease-in-out) infinite alternate;
    will-change: transform;
  }
  body::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background-image: ${GRAIN};
    background-size: 140px 140px;
    opacity: 0.06;
    mix-blend-mode: overlay;
  }
  @keyframes aurora-drift {
    from { transform: translate3d(0, 0, 0) scale(1); }
    to { transform: translate3d(-3%, 2.5%, 0) scale(1.08); }
  }

  /* ---- Broad Liquid Glass: the frosted material across the panel ---- */
  ${GLASS_SURFACES} {
    background: var(--mc-glass-bg-row);
    -webkit-backdrop-filter: blur(var(--mc-glass-blur)) saturate(var(--mc-glass-sat));
    backdrop-filter: blur(var(--mc-glass-blur)) saturate(var(--mc-glass-sat));
    box-shadow:
      inset 0 1px 0 var(--mc-glass-highlight),
      inset 0 0 0 1px var(--mc-glass-edge),
      var(--mc-glass-shadow);
  }

  /* Recessed inset panels: near-solid tint, NO backdrop-filter (they nest inside
     glass cards, so a second blur is intentionally avoided). */
  ${INSET_PANELS} {
    background: var(--mc-glass-tint);
    box-shadow:
      inset 0 0 0 1px var(--mc-glass-edge),
      inset 0 1px 0 var(--mc-glass-highlight);
  }

  /* The hero balance is the hero surface: a thicker, brighter slab of glass
     with a diagonal specular sheen — the piece meant to make people go "ooh". */
  .hero {
    background: var(--mc-glass-bg-hero);
    -webkit-backdrop-filter: blur(var(--mc-glass-blur-strong)) saturate(var(--mc-glass-sat));
    backdrop-filter: blur(var(--mc-glass-blur-strong)) saturate(var(--mc-glass-sat));
    border-radius: ${RADIUS.xl};
    box-shadow:
      inset 0 1px 0 var(--mc-glass-highlight-strong),
      inset 0 0 0 1px var(--mc-glass-edge),
      inset 0 -18px 40px -24px color-mix(in srgb, var(--mc-accent) 60%, transparent),
      var(--mc-elev-lg);
    overflow: hidden;
    padding: ${SPACE.xl} ${SPACE.lg} ${SPACE.lg};
    position: relative;
  }
  .hero::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      135deg,
      var(--mc-glass-sheen) 0%,
      transparent 42%,
      transparent 100%
    );
  }
  .hero > * { position: relative; }

  /* Action tiles: thicker glass; the primary (Send) tile carries an accent glow
     so the main action reads as lit. */
  button.action-tile {
    background: var(--mc-glass-bg);
    box-shadow:
      inset 0 1px 0 var(--mc-glass-highlight),
      inset 0 0 0 1px var(--mc-glass-edge),
      var(--mc-glass-shadow);
  }
  button.action-tile:not(:disabled):hover { background: var(--mc-glass-hover); }
  button.action-tile:not(:disabled):active { background: var(--mc-glass-press); }
  button.action-tile.primary {
    background: color-mix(in srgb, var(--mc-accent) 22%, var(--mc-glass-bg));
    box-shadow:
      inset 0 1px 0 var(--mc-glass-highlight),
      inset 0 0 0 1px color-mix(in srgb, var(--mc-accent) 34%, transparent),
      0 10px 28px -10px color-mix(in srgb, var(--mc-accent) 60%, transparent),
      var(--mc-glass-shadow);
  }
  button.action-tile.primary:not(:disabled):hover {
    background: color-mix(in srgb, var(--mc-accent) 30%, var(--mc-glass-bg));
  }
  button.action-tile.primary:not(:disabled):active {
    background: color-mix(in srgb, var(--mc-accent) 38%, var(--mc-glass-bg));
  }

  /* Rows keep their glass on hover/press by tinting the frosted fill rather than
     swapping to an opaque colour (which would flash solid over the aurora). */
  li.token-row:hover { background: var(--mc-glass-hover); }
  li.token-row:has(button.token-open:active) { background: var(--mc-glass-press); }
  button.menu-row:not(:disabled):hover,
  a.menu-row:hover,
  button.option-row:not(:disabled):hover { background: var(--mc-glass-hover); }
  button.menu-row:not(:disabled):active,
  button.option-row:not(:disabled):active { background: var(--mc-glass-press); }
  button.option-row[aria-pressed="true"],
  button.option-row[aria-pressed="true"]:not(:disabled):hover {
    background: color-mix(in srgb, var(--mc-accent) 20%, var(--mc-glass-bg-row));
  }
  button.collectible-card:not(:disabled):hover { background: var(--mc-glass-hover); }
  button.collectible-card:not(:disabled):active { background: var(--mc-glass-press); }

  /* The callout keeps an accent-forward frosted tint so it still signals. */
  .callout { background: color-mix(in srgb, var(--mc-accent) 20%, var(--mc-glass-bg)); }

  /* The QR stays a solid light tile (never glass) so the code keeps maximum
     contrast and scans in both skins — it just gains a floating depth shadow so
     it reads as a physical chip resting on the aurora. */
  .qr-card {
    box-shadow: var(--mc-elev-lg);
  }

  /* Focused form fields brighten the frost and pick up an accent ring. */
  input:focus-visible, select:focus-visible, textarea:focus-visible {
    background: var(--mc-glass-hover);
  }

  /* ---- Graceful degradation: mirror the base .glass fallbacks ---- */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    ${GLASS_SURFACES} {
      background: var(--mc-panel);
      box-shadow: var(--mc-glass-shadow);
    }
    .hero::before { display: none; }
  }
  @media (prefers-reduced-transparency: reduce) {
    ${ALL_GLASS} {
      background: var(--mc-panel);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
    .hero::before { display: none; }
    body::before { animation: none; }
  }
  @media (prefers-contrast: more) {
    ${ALL_GLASS} {
      background: var(--mc-panel);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
      box-shadow: inset 0 0 0 1px var(--mc-border), var(--mc-glass-shadow);
    }
    .hero::before { display: none; }
    body::before { opacity: 0.5; }
  }

  /* Reduced motion: the aurora holds still (static, fully legible frost). */
  @media (prefers-reduced-motion: reduce) {
    body::before { animation: none; }
  }
`;
