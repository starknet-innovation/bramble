/**
 * Control layer of the side panel stylesheet: buttons, forms, the focus
 * system, and the gate screens. Composed between the base layer
 * (./styles-base.ts) and the component layer (./styles-components.ts) in
 * ./styles.ts.
 *
 * Interaction contract: every pressable control answers the pointer — hover
 * states are gated to fine pointers (a tap must never leave a phantom hover),
 * presses respond with an instant background shift plus a subtle scale inside
 * the 0.92–1.0 envelope, and keyboard focus draws one consistent accent ring
 * (an outer halo on buttons and rows, a hugging inner ring on filled fields).
 * Feedback transforms ride the strong ease-out curve — never an overshoot on
 * the press-down frame the user watches most.
 */
import { CONTROL, MOTION, RADIUS, SIZE, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

// Chevron shape for the select control, consumed as a CSS mask so the glyph is
// PAINTED by the skin's muted token — a mask reads only the alpha channel, so
// the stroke paint below is arbitrary (any opaque value; it is not a colour
// choice). This replaces a hardcoded grey background image that could not
// follow the active theme.
const CHEVRON_MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='red' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

/**
 * Control stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const CONTROL_STYLES = `  /* Buttons: pill CTAs and circular icon buttons. appearance:none removes the
     native button bevel (a light top edge + dark bottom edge) so controls are
     genuinely borderless; feedback is a colour shift plus a subtle press scale. */
  button, a.icon-button {
    align-items: center;
    appearance: none;
    -webkit-appearance: none;
    background: var(--bramble-accent);
    border: 0;
    border-radius: ${RADIUS.full};
    box-shadow: none;
    color: var(--bramble-accent-text);
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-weight: ${WEIGHT.medium};
    gap: ${SPACE.sm};
    justify-content: center;
    letter-spacing: -0.01em;
    min-height: ${SIZE.control};
    min-width: 0;
    padding: 0 ${SPACE.lg};
    text-decoration: none;
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      border-color ${MOTION.pressMs}ms ${MOTION.ease},
      color ${MOTION.pressMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms var(--ease-out);
  }
  :where(button:not(:disabled):active), a.icon-button:active { background: var(--bramble-accent-press); transform: scale(0.98); }
  button.secondary {
    background: var(--bramble-elevated);
    color: var(--bramble-text);
  }
  button.icon-button, a.icon-button {
    background: transparent;
    color: var(--bramble-text);
  }
  button.secondary:not(:disabled):active, button.icon-button:not(:disabled):active, a.icon-button:active {
    background: var(--bramble-soft-press);
  }
  button.ghost, a.icon-button.ghost {
    background: transparent;
    color: var(--bramble-muted);
  }
  /* Switch: a label beside a track whose knob moves and inverts when on. The
     surface is a fill, not a ring, per the Clean Mono control rule. */
  button.switch-control {
    background: var(--bramble-sunken);
    border-radius: ${RADIUS.full};
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    gap: ${SPACE.sm};
    /* A button stretches to its container and centres its content; a switch is
       its own small control, so it sizes to its label and stays at the start. */
    justify-self: start;
    min-height: ${CONTROL.hitSmall};
    padding: 0 4px 0 ${SPACE.md};
  }
  .switch-copy { align-items: center; display: inline-flex; gap: 5px; }
  .switch-copy .icon { height: 13px; width: 13px; }
  .switch-track {
    align-items: center;
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.full};
    box-sizing: border-box;
    display: inline-flex;
    height: 24px;
    justify-content: flex-start;
    padding: 3px;
    width: 40px;
  }
  .switch-knob {
    background: var(--bramble-muted);
    border-radius: ${RADIUS.full};
    height: 18px;
    width: 18px;
  }
  button.switch-control[data-checked="true"] { color: var(--bramble-text); }
  button.switch-control[data-checked="true"] .switch-track {
    background: var(--bramble-text);
    justify-content: flex-end;
  }
  button.switch-control[data-checked="true"] .switch-knob { background: var(--bramble-bg); }
  @media (hover: hover) and (pointer: fine) {
    button.switch-control:not(:disabled):hover {
      background: var(--bramble-hover);
      color: var(--bramble-text);
    }
  }
  button.switch-control:not(:disabled):active { background: var(--bramble-soft-press); }
  .address-advanced-fields { display: grid; gap: ${SPACE.md}; }
  .address-advanced-fields[hidden] { display: none; }
  button.danger { background: var(--bramble-elevated); color: var(--bramble-danger); }
  button.danger:not(:disabled):active { background: var(--bramble-danger-soft); }
  @media (hover: hover) and (pointer: fine) {
    /* The primary fill is a fallback, not a specificity trap: component rows
       declare their own neutral hover surfaces later in the cascade. */
    :where(button:not(:disabled):hover) { background: var(--bramble-accent-hover); }
    button.secondary:not(:disabled):hover, button.icon-button:not(:disabled):hover, a.icon-button:hover {
      background: var(--bramble-hover);
    }
    button.ghost:not(:disabled):hover, a.icon-button.ghost:hover { background: var(--bramble-hover); color: var(--bramble-text); }
    button.danger:not(:disabled):hover { background: var(--bramble-danger-soft); }
  }
  button.icon-button, a.icon-button { flex: none; height: ${CONTROL.hit}; min-height: 0; padding: 0; width: ${CONTROL.hit}; }
  button.icon-button:not(:disabled):active, a.icon-button:active { transform: scale(0.96); }
  button.small { font-size: ${TYPE.label.size}; min-height: ${CONTROL.hitSmall}; padding: 0 ${SPACE.md}; }
  button:disabled, input:disabled, select:disabled, textarea:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  button[data-busy] { opacity: 0.7; }

  /* Forms */
  form { display: grid; gap: ${SPACE.md}; }
  label { display: grid; gap: 6px; }
  label > span:first-child, .eyebrow, .context-label {
    color: var(--bramble-muted);
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.semibold};
  }
  .eyebrow { letter-spacing: 0.02em; text-transform: uppercase; font-size: ${TYPE.caption.size}; }
  /* A field that carries a trailing action keeps one edge: the input fills the
     row and the control sits over it, inside the same bottom stroke, so the
     field reads as one control rather than a box with a button beside it. */
  .field-with-action { align-items: center; display: flex; gap: ${SPACE.xs}; min-width: 0; }
  .field-with-action > input { flex: 1; min-width: 0; }
  .field-with-action > .field-action { flex: none; }
  /* A field's fill sits within 1.1:1 of the panel behind it, so the fill alone
     cannot identify the control. Clean Mono draws no rings around surfaces —
     per-side dividers are the only strokes it allows — so the edge that
     identifies a field is a bottom stroke, the filled-field convention, in the
     tested field-edge token (>= 3:1 against every surface tier). */
  input, select, textarea {
    appearance: none;
    -webkit-appearance: none;
    background: var(--bramble-elevated);
    border: 0;
    border-bottom: 1px solid var(--bramble-border);
    border-radius: ${RADIUS.md};
    color: var(--bramble-text);
    font: inherit;
    min-height: ${SIZE.control};
    min-width: 0;
    padding: 0 ${SPACE.md};
    transition: background ${MOTION.pressMs}ms ${MOTION.ease};
    width: 100%;
  }
  @media (hover: hover) and (pointer: fine) {
    input:not(:disabled):hover, select:not(:disabled):hover, textarea:not(:disabled):hover {
      background: var(--bramble-hover);
    }
  }
  /* Placeholders stay at the full muted ink — a faded placeholder fell below
     WCAG AA (≈2.9:1) on the field fill. Opacity 1 also overrides the UA's own
     placeholder fade so the token value is what actually renders. */
  input::placeholder, textarea::placeholder { color: var(--bramble-muted); opacity: 1; }
  /* Checkboxes are compact native controls, not text fields: the generic input
     treatment (full-width 46px elevated fill with appearance:none) would erase
     the check entirely. Native rendering + accent-color keeps them crisp and
     theme-correct, and their wrapping label lays out as a tappable row. */
  input[type="checkbox"] {
    accent-color: var(--bramble-accent);
    appearance: auto;
    -webkit-appearance: auto;
    flex: none;
    height: 17px;
    min-height: 0;
    padding: 0;
    width: 17px;
  }
  label:has(> input[type="checkbox"]) {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
  }
  /* Select chevron: the glyph is a mask filled with the muted token, so it
     follows every skin. Anchored on the wrapping label (selects always render
     as a label's last child) and centred on the control's 46px height. */
  select { padding-right: 40px; }
  label:has(> select:last-child) { position: relative; }
  label:has(> select:last-child)::after {
    background: var(--bramble-muted);
    bottom: 16px;
    content: "";
    height: 14px;
    -webkit-mask: ${CHEVRON_MASK} center / contain no-repeat;
    mask: ${CHEVRON_MASK} center / contain no-repeat;
    pointer-events: none;
    position: absolute;
    right: 14px;
    width: 14px;
  }
  textarea {
    font-family: var(--bramble-font-mono);
    font-size: ${TYPE.mono.size};
    line-height: 1.6;
    min-height: 96px;
    padding: ${SPACE.sm} ${SPACE.md};
    resize: vertical;
  }
  input.mono { font-family: var(--bramble-font-mono); font-size: ${TYPE.mono.size}; }
  .hint { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
  .lede { color: var(--bramble-muted); }
  [role="status"] { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; min-height: 16px; overflow-wrap: anywhere; }

  /* Focus system: one accent ring, drawn once here for the whole panel. Filled
     fields focus with a ring hugging just inside their edge (the field lights
     up); everything else gets an offset halo that never collides with hairline
     edges or shadows. Both follow the element's radius. */
  :focus-visible { outline: 2px solid var(--bramble-focus-ring); outline-offset: 2px; }
  input:focus-visible, select:focus-visible, textarea:focus-visible {
    background: var(--bramble-elevated);
    outline-offset: -2px;
  }
  ::selection { background: color-mix(in srgb, var(--bramble-accent) 26%, transparent); }

  /* Gate screens: centered brand, big heading, primary action at the bottom */
  .gate { align-items: center; display: flex; flex: 1; flex-direction: column; gap: ${SPACE.lg}; padding-top: ${SPACE.xl}; text-align: center; }
  .gate-brand {
    align-items: center;
    background: var(--bramble-accent);
    border-radius: ${RADIUS.full};
    color: var(--bramble-accent-text);
    display: inline-flex;
    height: 64px;
    justify-content: center;
    margin-top: ${SPACE.xl};
    width: 64px;
  }
  .gate-brand .icon { height: 30px; width: 30px; }
  .gate-brand .brand-glyph { height: 32px; width: 32px; }
  .gate-head { display: grid; gap: 6px; max-width: 34ch; }
  .gate-head h1 { font-size: ${TYPE.headline.size}; font-weight: ${WEIGHT.heavy}; letter-spacing: -0.02em; line-height: ${TYPE.headline.line}; text-wrap: balance; }
  .gate-form { display: flex; flex: 1; flex-direction: column; gap: ${SPACE.md}; text-align: left; width: 100%; }
  .gate-cta { display: grid; gap: ${SPACE.sm}; margin-top: auto; padding-top: ${SPACE.lg}; }
  .gate-cta button { width: 100%; }
  .gate-alt { border-top: 1px solid var(--bramble-hairline); display: grid; gap: ${SPACE.sm}; padding-top: ${SPACE.lg}; text-align: left; width: 100%; }
  .gate-alt .gate-form { flex: none; }
  .gate-alt .gate-cta { margin-top: ${SPACE.sm}; padding-top: 0; }
  /* Reinitialize route: a quiet disclosure under the primary Unlock action, the
   * only way forward for a reader who cannot open the vault. */
  .gate-more { border-top: 1px solid var(--bramble-hairline); padding-top: ${SPACE.sm}; text-align: left; width: 100%; }
  .gate-more-summary { color: var(--bramble-muted); cursor: pointer; font-size: ${TYPE.caption.size}; font-weight: ${WEIGHT.medium}; list-style: none; padding: ${SPACE.xs} 0; }
  .gate-more-summary::-webkit-details-marker { display: none; }
  .gate-more-panel { display: grid; gap: ${SPACE.sm}; padding-top: ${SPACE.sm}; }
  .gate-more-copy { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
  .gate-more .gate-cta { margin-top: 0; padding-top: 0; }
`;
