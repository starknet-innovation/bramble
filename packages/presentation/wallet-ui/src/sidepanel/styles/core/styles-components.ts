/**
 * Component layer of the side panel stylesheet: callouts, data display,
 * token/transaction rows, review panels, NFT and request cards, pills, badges,
 * reveal, QR, and toasts. Composed between the control layer
 * (./styles-controls.ts) and the home/motion layer (./styles-home.ts) in
 * ./styles.ts.
 *
 * Surface rules: controls are borderless (structure from elevation and space),
 * fills are solid, and feedback transforms stay inside the press/lift envelope
 * enforced by tests/sidepanel/sidepanel-styles.test.ts. Colour discipline:
 * interactive and active states use the skin's neutral ramp or its accent
 * (neutral ink in midnight, brand blue in daylight); market and status semantics
 * ride --bramble-positive/--bramble-danger so a gain, success, or risk always reads by
 * meaning rather than decorative hue.
 */
import { CONTROL, MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";
import { SIGN_REQUEST_STYLES } from "../../shared/sign-request";

/**
 * Component stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const COMPONENT_STYLES = `  /* Content groups are flush — spacing only, no nested card borders. Genuine
     cards (callout, review panel, request/nft cards) carry their own single
     border below. */
  .section { display: grid; gap: ${SPACE.md}; }
  #deploy-button { width: 100%; }
  /* Callout: a neutral panel card; the accent lives only in the leading icon
     chip, so a waiting request draws the eye without tinting the surface. */
  .callout {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    padding: ${SPACE.md} ${SPACE.lg};
  }
  .callout-icon {
    align-items: center;
    background: var(--bramble-accent-soft);
    border-radius: ${RADIUS.sm};
    color: var(--bramble-accent);
    display: inline-flex;
    flex: none;
    height: 34px;
    justify-content: center;
    width: 34px;
  }
  .callout-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .callout-copy strong { font-size: ${TYPE.body.size}; }
  .callout-copy p { font-size: ${TYPE.caption.size}; }

  /* Data display */
  code {
    color: var(--bramble-text);
    font-family: var(--bramble-font-mono);
    font-size: ${TYPE.mono.size};
    line-height: ${TYPE.mono.line};
    overflow-wrap: anywhere;
    word-break: break-all;
  }
  .value { color: var(--bramble-text); font-weight: ${WEIGHT.semibold}; overflow-wrap: anywhere; }
  .context-line code { overflow-wrap: normal; word-break: normal; }
  .address-line {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.md};
    padding: ${SPACE.sm} ${SPACE.sm} ${SPACE.sm} ${SPACE.md};
  }
  .address-line code { flex: 1; }
  .request-list { display: grid; gap: ${SPACE.sm}; }
  /* Address book / connected sites: one grouped surface, flat rows with inset
     dividers and trailing quiet actions. */
  .address-book {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    overflow: hidden;
  }
  .address-book > li {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: ${SPACE.sm};
    min-height: 52px;
    padding: ${SPACE.sm} ${SPACE.md} ${SPACE.sm} ${SPACE.lg};
    position: relative;
  }
  .address-book > li + li::before {
    background: var(--bramble-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto;
    left: ${SPACE.lg};
    position: absolute;
  }
  /* Keep a readable text column; when a row's trailing controls would leave
     less than that at narrow widths, the controls wrap beneath instead of
     being clipped at the card's right edge. */
  .address-book .stack-tight { flex: 1 1 120px; }
  /* Token list: de-boxed, flush rows carried by alignment and a single hairline
     divider — no per-row fill/edge/radius box. The right-hand fiat/change column
     is right-aligned with tabular figures; a hover fill still highlights a row.
     Row content sits on the page's text column (logos line up with the
     section heading) and the hover fill bleeds one step past it, so the fill
     never crowds the content. */
  .token-list { display: grid; }
  .token-row {
    align-items: center;
    border-radius: ${RADIUS.md};
    display: flex;
    gap: ${SPACE.md};
    margin: 0 -${SPACE.sm};
    padding: ${SPACE.md} ${SPACE.sm}; position: relative;
    transition: background ${MOTION.pressMs}ms ${MOTION.ease}, transform ${MOTION.liftMs}ms var(--ease-out);
  }
  /* Divider is a flat pseudo-line, not a border-top: a border-top curls along the row's border-radius and reads as a raised "top shadow" lip. It spans the text column, not the bleed. */
  .token-list > .token-row + .token-row::before { background: var(--bramble-hairline); content: ""; height: 1px; inset: 0 ${SPACE.sm} auto; position: absolute; transition: opacity ${MOTION.pressMs}ms ${MOTION.ease}; }
  /* A highlighted row is its own shape: the dividers on both of its edges step
     aside, so a rounded fill never runs into a straight hairline. */
  @media (hover: hover) and (pointer: fine) {
    li.token-row:hover { background: var(--bramble-hover); }
    .token-list > li.token-row:hover::before, .token-list > li.token-row:hover + .token-row::before { opacity: 0; }
  }
  li.token-row:has(button.token-open:active) { background: var(--bramble-soft-press); transform: scale(0.985); }
  .token-list > li.token-row:has(button.token-open:active)::before,
  .token-list > li.token-row:has(button.token-open:active) + .token-row::before { opacity: 0; }
  /* Manage tokens reads as the list's last row: the same bleed, and its glyph
     centred in the logo column so its label starts where the token names do.
     The portfolio still renders this row when every balance is hidden and no
     list exists, so the column does not depend on a preceding .token-list. */
  .home-tabs > button.menu-row { gap: ${SPACE.md}; margin: 0 -${SPACE.sm}; padding: 0 ${SPACE.sm}; width: calc(100% + ${SPACE.sm} * 2); }
  .home-tabs > button.menu-row .menu-icon { justify-content: center; width: 40px; }
  /* Token glyph: a neutral chip — the accent is reserved for signal, not logos. */
  .token-mark {
    align-items: center;
    background: var(--bramble-sunken);
    border-radius: ${RADIUS.full};
    color: var(--bramble-muted);
    display: inline-flex;
    flex: none;
    font-size: ${TYPE.micro.size};
    font-weight: ${WEIGHT.heavy};
    height: 40px;
    justify-content: center;
    letter-spacing: 0.02em;
    width: 40px;
  }
  /* Deterministic per-token tint for letter badges (avatar-palette hues) so
     catalog lists read as distinct rows, not a grey column. */
  .token-mark[data-tone="0"] { background: color-mix(in srgb, var(--bramble-avatar-0) 20%, var(--bramble-sunken)); color: color-mix(in srgb, var(--bramble-avatar-0) 80%, var(--bramble-text)); }
  .token-mark[data-tone="1"] { background: color-mix(in srgb, var(--bramble-avatar-1) 20%, var(--bramble-sunken)); color: color-mix(in srgb, var(--bramble-avatar-1) 80%, var(--bramble-text)); }
  .token-mark[data-tone="2"] { background: color-mix(in srgb, var(--bramble-avatar-2) 20%, var(--bramble-sunken)); color: color-mix(in srgb, var(--bramble-avatar-2) 80%, var(--bramble-text)); }
  .token-mark[data-tone="3"] { background: color-mix(in srgb, var(--bramble-avatar-3) 20%, var(--bramble-sunken)); color: color-mix(in srgb, var(--bramble-avatar-3) 80%, var(--bramble-text)); }
  .token-logo {
    border-radius: ${RADIUS.full};
    flex: none;
    height: 40px;
    object-fit: cover;
    width: 40px;
  }
  .token-copy { display: grid; flex: 1; gap: 2px; min-width: 0; }
  .token-copy strong { font-size: ${TYPE.body.size}; font-weight: ${WEIGHT.semibold}; }
  .token-copy p {
    font-size: ${TYPE.caption.size};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .token-amount {
    font-variant-numeric: tabular-nums;
    font-weight: ${WEIGHT.bold};
  }
  .token-side { align-items: flex-end; display: grid; flex: none; gap: 2px; text-align: right; }
  .token-fiat { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; font-variant-numeric: tabular-nums; }
  .token-change { font-size: ${TYPE.caption.size}; font-variant-numeric: tabular-nums; font-weight: ${WEIGHT.semibold}; }
  .token-change.up { color: var(--bramble-positive); }
  .token-change.down { color: var(--bramble-danger); }
  /* The whole row is the tap target; the row's own fill highlight is the hover
     affordance, so the embedded button stays visually inert (no second fill, no
     name recolor, no nested press scale — the row scales instead). */
  .token-row .token-open {
    background: transparent;
    border-radius: ${RADIUS.md};
    color: var(--bramble-text);
    flex: 1;
    justify-content: flex-start;
    min-height: 0;
    min-width: 0;
    padding: 0;
    text-align: left;
  }
  .token-row .token-open:not(:disabled):hover,
  .token-row .token-open:not(:disabled):active {
    background: transparent;
    transform: none;
  }
  .token-row.token-hidden { opacity: 0.6; }
  .token-flag {
    background: var(--bramble-danger-soft);
    border-radius: ${RADIUS.full};
    color: var(--bramble-danger);
    flex: none;
    font-size: 10px;
    font-weight: ${WEIGHT.bold};
    letter-spacing: 0.03em;
    padding: 3px 8px;
    text-transform: uppercase;
  }
  .token-detail-price { color: var(--bramble-text); font-size: ${TYPE.amount.size}; font-weight: ${WEIGHT.heavy}; letter-spacing: -0.02em; }
  /* Sparkline direction is a market signal: green up, red down — never brand. */
  .sparkline { display: block; height: 48px; width: 100%; }
  .sparkline polyline {
    fill: none;
    stroke: var(--bramble-muted);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .sparkline-up polyline { stroke: var(--bramble-positive); }
  .sparkline-down polyline { stroke: var(--bramble-danger); }
  .request-list { gap: ${SPACE.md}; }
  /* The risk panel is a card like the receipt and fee card it sits between:
     same fill, corner, and text inset, so a review reads as one stack. */
  .review-panel {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    gap: ${SPACE.sm};
    padding: ${SPACE.md} ${SPACE.lg};
  }
  .review-panel p { color: var(--bramble-text); font-size: ${TYPE.label.size}; }
  .review-panel .decision-label { color: var(--bramble-muted); font-size: ${TYPE.micro.size}; }
${SIGN_REQUEST_STYLES}
  .review-flag { color: var(--bramble-danger); font-size: ${TYPE.caption.size}; }
  .review-fee { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; }
  /* The total is what the account pays; the deployment share explains it and
     sits quieter, so the figure a user acts on is the one that reads first. */
  .review-fee > p { margin: 0; }
  .review-fee > p:first-child { color: var(--bramble-text); }
  .review-fee-part { font-size: ${TYPE.micro.size}; }
  /* What actually leaves the account. It is the figure the other lines add up
     to, so it carries the body colour they are quoted against. */
  .review-fee-total { color: var(--bramble-text); font-weight: ${WEIGHT.medium}; }
  .tx-hint { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
  /* Allowances: one grouped surface, flat rows with inset dividers. */
  .allowance-list {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    overflow: hidden;
  }
  .allowance-row {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    padding: ${SPACE.md} ${SPACE.lg};
    position: relative;
  }
  .allowance-row + .allowance-row::before {
    background: var(--bramble-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto;
    left: ${SPACE.lg};
    position: absolute;
  }
  /* Prepared multisig calls reuse the review panel as rows of this group: the
     group is the card, so each call is a flat row under an inset divider. */
  .allowance-list > .review-panel { border-radius: 0; position: relative; }
  .allowance-list > .review-panel + .review-panel::before { background: var(--bramble-hairline); content: ""; height: 1px; inset: 0 0 auto ${SPACE.lg}; position: absolute; }
  .allowance-copy { display: grid; flex: 1; gap: 2px; grid-template-columns: minmax(0, 1fr); min-width: 0; }
  .allowance-copy > * { min-width: 0; overflow-wrap: anywhere; }
  /* Revoke is red ink, not a red box — the row stays quiet until hovered. */
  .allowance-row button.danger { background: transparent; }
  .allowance-copy code { overflow-wrap: anywhere; }
  .allowance-spender { align-items: center; display: flex; gap: 2px; min-width: 0; }
  .allowance-spender code { min-width: 0; }
  /* Collectibles gallery: clean image tiles, not boxed cards. Each item is a
     minimally framed art square (a hairline on the art tile only) over a tight
     caption, with compact ghost actions — no fill/edge box wraps the whole item. */
  .nft-grid { display: grid; gap: ${SPACE.md}; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .nft-card { display: grid; gap: ${SPACE.sm}; min-width: 0; position: relative; }
  button.nft-open {
    align-content: start; background: transparent; color: var(--bramble-text); display: grid; gap: ${SPACE.sm};
    grid-template-columns: minmax(0, 1fr); min-height: 0; padding: 0; text-align: left;
  }
  button.nft-open:not(:disabled):hover, button.nft-open:not(:disabled):active { background: transparent; }
  @media (hover: hover) and (pointer: fine) {
    button.nft-open:not(:disabled):hover strong { color: var(--bramble-accent); }
  }
  .nft-art {
    align-items: center; aspect-ratio: 1 / 1; background: var(--bramble-soft); border-radius: ${RADIUS.md};
    color: var(--bramble-muted); display: inline-flex; justify-content: center;
    overflow: hidden; position: relative; transition: box-shadow ${MOTION.liftMs}ms ${MOTION.ease}; width: 100%;
  }
  .nft-art .icon { height: 28px; width: 28px; } .nft-image { border-radius: inherit; height: 100%; inset: 0; object-fit: cover; position: absolute; width: 100%; } .nft-image--pixelated { image-rendering: pixelated; } .nft-image--broken { display: none; }
  /* The detail hero owns an explicit width. Without it, the inline-flex art
     square shrink-wrapped to the image's intrinsic thumbnail dimensions. */
  .nft-hero { display: grid; gap: ${SPACE.sm}; margin: 0 auto ${SPACE.sm}; max-width: 240px; width: 100%; }
  .nft-animation { aspect-ratio: 1 / 1; border: 0; border-radius: ${RADIUS.md}; margin-top: ${SPACE.sm}; width: 100%; }
  .nft-animation[hidden] { display: none; }
  .nft-animation--tile { left: 0; margin: 0; position: absolute; top: 0; }
  /* The gallery play affordance overlays the art square and is revealed on
     hover/focus so a collectible's on-chain animation can be started in place. */
  .nft-play-tile {
    align-items: center; aspect-ratio: 1 / 1; background: var(--bramble-hover); border: 0;
    border-radius: ${RADIUS.md}; color: var(--bramble-text); cursor: pointer; display: flex; gap: 6px;
    font-size: ${TYPE.label.size}; font-weight: ${WEIGHT.medium}; justify-content: center; left: 0;
    opacity: 0; pointer-events: none; position: absolute; top: 0; width: 100%;
    transition: opacity ${MOTION.liftMs}ms ${MOTION.ease};
  }
  .nft-play-tile[hidden] { display: none; }
  .nft-play-tile .icon { height: 18px; width: 18px; }
  .nft-card:hover .nft-play-tile, .nft-card:focus-within .nft-play-tile { opacity: 1; pointer-events: auto; }
  button.nft-open:not(:disabled):active .nft-art { box-shadow: var(--bramble-shadow-sm); }
  .nft-copy { display: grid; gap: 2px; min-width: 0; padding: 0 2px; }
  .nft-copy strong { overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .nft-copy code { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  /* Compact two-up ghost actions; the danger Remove stays borderless like Hide
     (red ink carries the signal, not a box), with danger-soft hover feedback. */
  .nft-actions { display: grid; gap: 6px; grid-template-columns: 1fr 1fr; }
  .nft-actions button { min-width: 0; padding: 0 ${SPACE.sm}; }
  .nft-actions button.danger { background: transparent; }
  /* dApp approval/sign prompts are a solid panel card — a hairline edge plus a
     gentle low shadow lift a consequential request above the request list. */
  .request-card {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    box-shadow: var(--bramble-elev-sm);
    display: grid;
    gap: ${SPACE.md};
    padding: ${SPACE.lg};
  }
  .request-copy { display: grid; gap: ${SPACE.sm}; min-width: 0; }
  .request-site { align-items: center; display: flex; gap: ${SPACE.md}; min-width: 0; }
  .request-site-mark {
    align-items: center;
    background: var(--bramble-sunken);
    border-radius: ${RADIUS.md};
    color: var(--bramble-muted);
    display: inline-flex;
    flex: none;
    height: 40px;
    justify-content: center;
    width: 40px;
  }
  .request-site-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .request-site-copy > span { color: var(--bramble-muted); font-size: ${TYPE.micro.size}; }
  .request-site-copy strong { font-size: ${TYPE.body.size}; overflow-wrap: anywhere; }
  .request-site-copy code { color: var(--bramble-muted); font-size: ${TYPE.micro.size}; overflow-wrap: anywhere; word-break: normal; }
  .pill {
    align-items: center;
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.full};
    color: var(--bramble-text);
    display: inline-flex;
    flex: none;
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    gap: 6px;
    max-width: 100%;
    min-height: 28px;
    overflow: hidden;
    padding: 3px ${SPACE.md};
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  /* Hardware-wallet badge: a compact accent-tinted pill marking a Ledger
     account in lists so a keyless device account is never mistaken for a
     software one. Sits inline after the account name. */
  .pill-hardware {
    background: var(--bramble-accent-soft);
    color: var(--bramble-accent);
    margin-left: 6px;
    min-height: 20px;
    padding: 1px ${SPACE.sm};
    vertical-align: middle;
  }
  .pill-hardware .icon { height: 12px; width: 12px; }
  .dot { background: var(--bramble-positive); border-radius: ${RADIUS.full}; height: 7px; width: 7px; }
  /* Badge ink is the page ground so the count stays legible on the danger fill
     in both schemes (dark ink on the soft dark-theme red, light ink on the
     deep light-theme red) — never the accent's paired text colour, which
     tracks the accent. */
  .badge {
    background: var(--bramble-danger);
    border-radius: ${RADIUS.full};
    color: var(--bramble-bg);
    font-size: 10px;
    font-weight: ${WEIGHT.bold};
    line-height: 1;
    min-width: 16px;
    padding: 3px 5px;
    text-align: center;
  }
  /* Empty states are plain centered copy — an empty list is an absence, not a
     boxed component demanding attention. */
  .empty {
    color: var(--bramble-muted);
    font-size: ${TYPE.label.size};
    line-height: ${TYPE.body.line};
    padding: ${SPACE.lg} ${SPACE.md};
    text-align: center;
  }

  /* Reveal secrets: blurred until tapped; wiped whenever the shell re-renders */
  [hidden] { display: none !important; }
  /* The warning glyph leads its sentence like every other flagged line: a
     fixed gap, pinned to the first line so a wrapped warning stays aligned. */
  .reveal-danger { align-items: flex-start; color: var(--bramble-danger); display: flex; font-weight: ${WEIGHT.semibold}; gap: ${SPACE.sm}; }
  .reveal-danger .icon { flex: none; margin-top: 1px; }
  .reveal-output { display: grid; gap: ${SPACE.sm}; }
  .reveal-value {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.md};
    font-family: var(--bramble-font-mono);
    font-size: ${TYPE.mono.size};
    line-height: ${TYPE.mono.line};
    overflow-wrap: anywhere;
    padding: ${SPACE.sm} ${SPACE.md};
    word-break: break-all;
  }
  .reveal-value.is-masked, .gate-form textarea.is-masked { filter: blur(7px); user-select: none; }
  .verify-grid { display: grid; gap: ${SPACE.sm}; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  /* Words that do not match the phrase read as an error to fix, not a prompt. */
  #verify-result.is-invalid { color: var(--bramble-danger); }
  .icon {
    fill: none;
    height: ${CONTROL.icon};
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
    width: ${CONTROL.icon};
  }

  /* QR: fixed light card so codes scan identically in both themes. */
  .qr-card {
    background: hsl(0 0% 100%);
    border-radius: ${RADIUS.md};
    box-shadow: var(--bramble-elev-md);
    color: hsl(0 0% 8%);
    justify-self: center;
    padding: ${SPACE.sm};
    width: min(232px, 100%);
  }
  .qr { display: block; height: auto; width: 100%; }
  /* Toasts: pinned above the dock at the bottom of the panel; the offset is
     derived from the same dock-footprint token the bar itself uses, and the
     stack shares the shell's text column so a toast lines up with the cards
     above it. */
  .toast-stack {
    bottom: calc(var(--bramble-dock-h) + ${SPACE.md});
    display: grid;
    gap: ${SPACE.sm};
    left: ${SPACE.lg};
    pointer-events: none;
    position: fixed;
    right: ${SPACE.lg};
    z-index: 10;
  }
  /* Toasts are a solid panel card dragged/dismissed with an interruptible WAAPI
     spring from ./dom.ts, so their entrance is not a CSS keyframe (keyframes
     restart from zero and cannot be grabbed mid-flight). Fixed scannable
     anatomy: a leading tone chip — green check for success, red alert for
     error — reads before any text, so the outcome lands at a glance; the
     deepest shadow tier makes arrival unmistakable over any content. */
  .toast {
    align-items: center;
    background: var(--bramble-panel);
    border-radius: ${RADIUS.md};
    box-shadow: var(--bramble-elev-lg);
    color: var(--bramble-text);
    display: flex;
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.medium};
    gap: 10px;
    padding: 10px ${SPACE.md} 10px 10px;
    pointer-events: auto;
    touch-action: pan-y;
  }
  .toast-icon {
    align-items: center;
    border-radius: ${RADIUS.sm};
    display: inline-flex;
    flex: none;
    height: 30px;
    justify-content: center;
    width: 30px;
  }
  .toast.success .toast-icon { background: var(--bramble-positive-soft); color: var(--bramble-positive); }
  .toast.error .toast-icon { background: var(--bramble-danger-soft); color: var(--bramble-danger); }
  .toast.warning .toast-icon { background: var(--bramble-warning-soft); color: var(--bramble-warning); }
  .toast-icon .icon { height: 16px; width: 16px; }
  .toast-text {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }
  button.toast-copy { height: 30px; min-height: 30px; width: 30px; }
`;
