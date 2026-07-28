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
import { CONTROL, MOTION, RADIUS, SIZE, SPACE, TYPE, WEIGHT } from "../ui/tokens";

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
    background: var(--mc-accent);
    border: 0;
    border-radius: ${RADIUS.full};
    box-shadow: none;
    color: var(--mc-accent-text);
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
  :where(button:not(:disabled):active), a.icon-button:active { background: var(--mc-accent-press); transform: scale(0.98); }
  button.secondary {
    background: var(--mc-elevated);
    color: var(--mc-text);
  }
  button.icon-button, a.icon-button {
    background: transparent;
    color: var(--mc-text);
  }
  button.secondary:not(:disabled):active, button.icon-button:not(:disabled):active, a.icon-button:active {
    background: var(--mc-soft-press);
  }
  button.ghost, a.icon-button.ghost {
    background: transparent;
    color: var(--mc-muted);
  }
  button.danger { background: var(--mc-elevated); color: var(--mc-danger); }
  button.danger:not(:disabled):active { background: var(--mc-danger-soft); }
  @media (hover: hover) and (pointer: fine) {
    /* The primary fill is a fallback, not a specificity trap: component rows
       declare their own neutral hover surfaces later in the cascade. */
    :where(button:not(:disabled):hover) { background: var(--mc-accent-hover); }
    button.secondary:not(:disabled):hover, button.icon-button:not(:disabled):hover, a.icon-button:hover {
      background: var(--mc-hover);
    }
    button.ghost:not(:disabled):hover, a.icon-button.ghost:hover { background: var(--mc-hover); color: var(--mc-text); }
    button.danger:not(:disabled):hover { background: var(--mc-danger-soft); }
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
    color: var(--mc-muted);
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.semibold};
  }
  .eyebrow { letter-spacing: 0.02em; text-transform: uppercase; font-size: ${TYPE.caption.size}; }
  input, select, textarea {
    appearance: none;
    -webkit-appearance: none;
    background: var(--mc-elevated);
    border: 0;
    border-radius: ${RADIUS.md};
    color: var(--mc-text);
    font: inherit;
    min-height: ${SIZE.control};
    min-width: 0;
    padding: 0 ${SPACE.md};
    transition: background ${MOTION.pressMs}ms ${MOTION.ease};
    width: 100%;
  }
  @media (hover: hover) and (pointer: fine) {
    input:not(:disabled):hover, select:not(:disabled):hover, textarea:not(:disabled):hover {
      background: var(--mc-hover);
    }
  }
  /* Placeholders stay at the full muted ink — a faded placeholder fell below
     WCAG AA (≈2.9:1) on the field fill. Opacity 1 also overrides the UA's own
     placeholder fade so the token value is what actually renders. */
  input::placeholder, textarea::placeholder { color: var(--mc-muted); opacity: 1; }
  /* Checkboxes are compact native controls, not text fields: the generic input
     treatment (full-width 46px elevated fill with appearance:none) would erase
     the check entirely. Native rendering + accent-color keeps them crisp and
     theme-correct, and their wrapping label lays out as a tappable row. */
  input[type="checkbox"] {
    accent-color: var(--mc-accent);
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
    background: var(--mc-muted);
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
    font-family: var(--mc-font-mono);
    font-size: ${TYPE.mono.size};
    line-height: 1.6;
    min-height: 96px;
    padding: ${SPACE.sm} ${SPACE.md};
    resize: vertical;
  }
  input.mono { font-family: var(--mc-font-mono); font-size: ${TYPE.mono.size}; }
  .hint { color: var(--mc-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
  .lede { color: var(--mc-muted); }
  [role="status"] { color: var(--mc-muted); font-size: ${TYPE.caption.size}; min-height: 16px; overflow-wrap: anywhere; }

  /* Focus system: one accent ring, drawn once here for the whole panel. Filled
     fields focus with a ring hugging just inside their edge (the field lights
     up); everything else gets an offset halo that never collides with hairline
     edges or shadows. Both follow the element's radius. */
  :focus-visible { outline: 2px solid var(--mc-focus-ring); outline-offset: 2px; }
  input:focus-visible, select:focus-visible, textarea:focus-visible {
    background: var(--mc-elevated);
    outline-offset: -2px;
  }
  ::selection { background: color-mix(in srgb, var(--mc-accent) 26%, transparent); }

  /* Gate screens: centered brand, big heading, primary action at the bottom */
  .gate { align-items: center; display: flex; flex: 1; flex-direction: column; gap: ${SPACE.lg}; padding-top: ${SPACE.xl}; text-align: center; }
  .gate-brand {
    align-items: center;
    background: var(--mc-accent);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent-text);
    display: inline-flex;
    height: 64px;
    justify-content: center;
    margin-top: ${SPACE.xl};
    width: 64px;
  }
  .gate-brand .icon { height: 30px; width: 30px; }
  .gate-head { display: grid; gap: 6px; max-width: 34ch; }
  .gate-head h1 { font-size: ${TYPE.headline.size}; font-weight: ${WEIGHT.heavy}; letter-spacing: -0.02em; line-height: ${TYPE.headline.line}; text-wrap: balance; }
  .gate-form { display: flex; flex: 1; flex-direction: column; gap: ${SPACE.md}; text-align: left; width: 100%; }
  .gate-cta { display: grid; gap: ${SPACE.sm}; margin-top: auto; padding-top: ${SPACE.lg}; }
  .gate-cta button { width: 100%; }
  .gate-alt { border-top: 1px solid var(--mc-hairline); display: grid; gap: ${SPACE.sm}; padding-top: ${SPACE.lg}; text-align: left; width: 100%; }
  .gate-alt .gate-form { flex: none; }
  .gate-alt .gate-cta { margin-top: ${SPACE.sm}; padding-top: 0; }
`;
