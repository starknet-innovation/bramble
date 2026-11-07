/**
 * Focused journey polish for approval liveness, Ledger status, NFT sending,
 * and compact management subflows. All color and scale values come from the
 * shared skin tokens.
 */
import { CONTROL, MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

/**
 * Journey-specific styles composed after shared component structure.
 */
export const JOURNEY_STYLES = `
  #deploy-review { display: grid; gap: ${SPACE.sm}; width: 100%; }
  /* Staking rows reuse the allowance group; actions and amount fields sit
     under the position lines, full width, so nothing crowds the row. */
  .staking-actions { display: flex; flex-wrap: wrap; gap: ${SPACE.sm}; margin-top: ${SPACE.xs}; }
  .staking-form {
    align-items: center;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: minmax(0, 1fr) auto;
    margin-top: ${SPACE.xs};
  }
  .staking-form input { min-width: 0; }
  /* An action under review stacks one item per line: the typed amount stays
     full width, its review sentence sits directly above its confirm, and the
     confirm (which carries the fee) takes the full width. */
  .staking-form[data-staking-open] { grid-template-columns: minmax(0, 1fr); }
  .staking-actions[data-staking-open] { display: grid; justify-items: start; }
  [data-staking-open] > .staking-review { margin-top: 0; }
  /* The paste field and the opened validator: the address wraps, never clips. */
  .staking-paste { margin-bottom: ${SPACE.sm}; }
  .staking-validator { display: grid; gap: ${SPACE.xs}; justify-items: start; margin-bottom: ${SPACE.sm}; }
  .staking-validator code { max-width: 100%; }
  .staking-more { display: flex; justify-content: center; margin-top: ${SPACE.sm}; }
  /* A validator card or position row is one button: inline text, left-aligned,
     the row's own padding, a hover fill and the shared focus ring. */
  .staking-card-row { padding: 0; }
  button.staking-card {
    background: transparent;
    border-radius: ${RADIUS.lg};
    color: var(--bramble-text);
    font-weight: ${WEIGHT.regular};
    justify-content: space-between;
    padding: ${SPACE.md} ${SPACE.lg};
    text-align: left;
    width: 100%;
  }
  button.staking-card .staking-copy > * { display: block; }
  @media (hover: hover) and (pointer: fine) {
    button.staking-card:not(:disabled):hover { background: var(--bramble-hover); }
  }
  .staking-paste-label { margin-top: ${SPACE.md}; }
  .home-staking { display: grid; gap: ${SPACE.sm}; }
  button.hero-staked {
    background: transparent;
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.xs};
    min-height: 32px;
    padding: 0 ${SPACE.xs};
  }
  button.hero-staked .icon { height: 13px; width: 13px; }
  .allowance-review, .staking-review {
    color: var(--bramble-text);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
    margin-top: ${SPACE.xs};
  }
  .staking-review[data-severity="error"] { color: var(--bramble-danger); }
  .staking-review[data-severity="warning"] { color: var(--bramble-warning); }
  .approval-live {
    align-items: center;
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    box-shadow: var(--bramble-elev-sm);
    display: grid;
    gap: ${SPACE.md};
    grid-template-columns: auto minmax(0, 1fr);
    padding: ${SPACE.lg};
  }
  .approval-live-mark {
    align-items: center;
    background: var(--bramble-accent-soft);
    border-radius: ${RADIUS.full};
    color: var(--bramble-accent);
    display: inline-flex;
    height: 40px;
    justify-content: center;
    width: 40px;
  }
  .approval-live div { display: grid; gap: 2px; min-width: 0; }
  .approval-live strong { font-size: ${TYPE.body.size}; font-weight: ${WEIGHT.semibold}; }
  .approval-live p { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
  .request-account-choices { display: grid; gap: ${SPACE.xs}; }
  button.request-account-choice {
    align-items: center;
    background: transparent;
    border-radius: ${RADIUS.md};
    color: var(--bramble-text);
    display: flex;
    gap: ${SPACE.sm};
    justify-content: space-between;
    min-height: ${CONTROL.hit};
    padding: 0 ${SPACE.sm};
    text-align: left;
    width: 100%;
  }
  button.request-account-choice strong { font-weight: ${WEIGHT.medium}; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  button.request-account-choice code { color: var(--bramble-muted); flex: none; font-size: ${TYPE.caption.size}; }
  button.request-account-choice[aria-pressed="true"] { background: var(--bramble-accent-soft); }
  @media (hover: hover) and (pointer: fine) {
    button.request-account-choice:not(:disabled):hover { background: var(--bramble-hover); }
    button.request-account-choice[aria-pressed="true"]:not(:disabled):hover { background: var(--bramble-accent-soft); }
  }
  .request-card[data-state="working"] > :not(.button-row) {
    opacity: 0.46;
    transition: opacity ${MOTION.pressMs}ms ${MOTION.ease};
  }
  .request-technical .request-detail { margin-top: 0; }
  .strk20-action-review,
  .strk20-action-call {
    display: grid;
    gap: ${SPACE.sm};
    min-width: 0;
  }
  .strk20-action-review + .strk20-action-review { margin-top: ${SPACE.sm}; }
  .strk20-action-call { margin-left: ${SPACE.sm}; }

  .ledger-liveness {
    align-items: center;
    color: var(--bramble-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.sm};
    justify-content: center;
    margin: 0;
    text-align: center;
  }
  .ledger-liveness-mark {
    align-items: center;
    color: var(--bramble-accent);
    display: inline-flex;
    flex: none;
  }
  .ledger-liveness-mark .icon { height: 16px; width: 16px; }

  .nft-send-identity {
    align-items: center;
    display: grid;
    gap: ${SPACE.md};
    grid-template-columns: 92px minmax(0, 1fr);
  }
  .nft-send-identity .receipt { min-width: 0; }
  /* At side-panel widths the receipt stacks under the art instead of
     squeezing its labels into their values ("CollectionBramble" at 360 px). */
  @media (max-width: 420px) {
    .nft-send-identity { grid-template-columns: minmax(0, 1fr); }
    .nft-send-identity .nft-send-art { width: 92px; }
  }
  .nft-send-art {
    align-items: center;
    aspect-ratio: 1;
    background: var(--bramble-soft);
    border-radius: ${RADIUS.lg};
    color: var(--bramble-muted);
    display: flex;
    justify-content: center;
    overflow: hidden;
    position: relative;
    width: 92px;
  }
  .nft-send-art .icon { height: 26px; width: 26px; }
  #nft-send-form[data-stage="reviewing"] #nft-review-panel,
  #nft-send-form[data-stage="submitting"] #nft-review-panel { opacity: 0.62; }

`;
