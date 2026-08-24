/**
 * Focused journey polish for approval liveness, Ledger status, NFT sending,
 * and compact management subflows. All color and scale values come from the
 * shared skin tokens.
 */
import { MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "@mc-wallet/ui-kit/tokens";

/**
 * Journey-specific styles composed after shared component structure.
 */
export const JOURNEY_STYLES = `
  #deploy-review { display: grid; gap: ${SPACE.sm}; width: 100%; }
  .allowance-review {
    color: var(--mc-text);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
    margin-top: ${SPACE.xs};
  }
  .approval-live {
    align-items: center;
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    box-shadow: var(--mc-elev-sm);
    display: grid;
    gap: ${SPACE.md};
    grid-template-columns: auto minmax(0, 1fr);
    padding: ${SPACE.lg};
  }
  .approval-live-mark {
    align-items: center;
    background: var(--mc-accent-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent);
    display: inline-flex;
    height: 40px;
    justify-content: center;
    width: 40px;
  }
  .approval-live div { display: grid; gap: 2px; min-width: 0; }
  .approval-live strong { font-size: ${TYPE.body.size}; font-weight: ${WEIGHT.semibold}; }
  .approval-live p { color: var(--mc-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
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
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.sm};
    justify-content: center;
    margin: 0;
    text-align: center;
  }
  .ledger-liveness-mark {
    align-items: center;
    color: var(--mc-accent);
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
  .nft-send-art {
    align-items: center;
    aspect-ratio: 1;
    background: var(--mc-soft);
    border-radius: ${RADIUS.lg};
    color: var(--mc-muted);
    display: flex;
    justify-content: center;
    overflow: hidden;
    position: relative;
    width: 92px;
  }
  .nft-send-art .icon { height: 26px; width: 26px; }
  .nft-transfer-outcome {
    align-items: flex-start;
    background: var(--mc-positive-soft);
    border-radius: ${RADIUS.lg};
    color: var(--mc-positive);
    display: grid;
    gap: ${SPACE.md};
    grid-template-columns: auto minmax(0, 1fr);
    padding: ${SPACE.lg};
  }
  .nft-transfer-outcome > div { display: grid; gap: 3px; min-width: 0; }
  .nft-transfer-outcome p { color: var(--mc-text); font-size: ${TYPE.caption.size}; }
  .nft-transfer-outcome code {
    color: var(--mc-muted);
    font-size: ${TYPE.micro.size};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .nft-transfer-mark {
    align-items: center;
    background: var(--mc-positive);
    border-radius: ${RADIUS.full};
    color: var(--mc-bg);
    display: inline-flex;
    height: 30px;
    justify-content: center;
    width: 30px;
  }
  .nft-transfer-mark .icon { height: 16px; width: 16px; }
  #nft-send-form[data-stage="reviewing"] #nft-review-panel,
  #nft-send-form[data-stage="submitting"] #nft-review-panel { opacity: 0.62; }

`;
