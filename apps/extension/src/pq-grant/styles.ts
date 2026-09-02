/**
 * Stylesheet for `pq-grant.html`, composed from the extension's shared skin and
 * scale tokens so this one-time device step reads as part of the wallet rather
 * than as a stray page. Chrome's Bluetooth chooser stays browser chrome; this
 * styles only what surrounds it.
 *
 * Deliberately a fraction of the Ledger grant page's stylesheet. There is no
 * device illustration, no transport picker and no per-transport diagnostic
 * surface here, because there is one transport and one device.
 */
import { FONT, RADIUS, SPACE, TRACKING, TYPE, WEIGHT } from "@mc-wallet/ui-kit/tokens";

/**
 * Token-driven stylesheet for the paired-phone device tab.
 */
export const PQ_GRANT_STYLES = `
  :root {
    color-scheme: dark;
    --pq-hairline: color-mix(in srgb, var(--mc-text) 12%, transparent);
    --pq-accent-soft: color-mix(in srgb, var(--mc-accent) 13%, var(--mc-panel));
    --pq-positive-soft: color-mix(in srgb, var(--mc-positive) 13%, var(--mc-panel));
    --pq-danger-soft: color-mix(in srgb, var(--mc-danger) 12%, var(--mc-panel));
  }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: ${SPACE.lg};
    background: var(--mc-bg);
    color: var(--mc-text);
    font-family: ${FONT.ui};
  }
  .pq-shell {
    width: min(34rem, 100%);
    display: flex;
    flex-direction: column;
    gap: ${SPACE.lg};
    padding: ${SPACE.xl};
    border: 1px solid var(--pq-hairline);
    border-radius: ${RADIUS.lg};
    background: var(--mc-panel);
  }
  .pq-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .pq-brand {
    display: inline-flex;
    align-items: center;
    gap: ${SPACE.sm};
    font-weight: ${WEIGHT.semibold};
  }
  .pq-brand-mark {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: ${RADIUS.sm};
    background: var(--mc-accent);
    color: var(--mc-bg);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.bold};
  }
  .pq-once {
    font-size: ${TYPE.caption.size};
    letter-spacing: ${TRACKING.eyebrow};
    text-transform: uppercase;
    color: var(--mc-muted);
  }
  .pq-copy h1 {
    margin: 0 0 ${SPACE.sm};
    font-size: ${TYPE.display.size};
  }
  .pq-copy p {
    margin: 0;
    color: var(--mc-muted);
    font-size: ${TYPE.body.size};
    line-height: 1.5;
  }
  .pq-steps {
    display: flex;
    flex-direction: column;
    gap: ${SPACE.sm};
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pq-step {
    display: flex;
    align-items: center;
    gap: ${SPACE.sm};
    font-size: ${TYPE.body.size};
  }
  .pq-step-index {
    display: grid;
    place-items: center;
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 999px;
    border: 1px solid var(--pq-hairline);
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
  }
  .pq-status {
    padding: ${SPACE.md};
    border-radius: ${RADIUS.md};
    background: var(--pq-accent-soft);
    font-size: ${TYPE.body.size};
  }
  .pq-status[data-tone="success"] { background: var(--pq-positive-soft); }
  .pq-status[data-tone="danger"] { background: var(--pq-danger-soft); }
  .pq-status strong { display: block; margin-bottom: ${SPACE.xs}; }
  .pq-status p { margin: 0; color: var(--mc-muted); line-height: 1.5; }
  .pq-actions {
    display: flex;
    align-items: center;
    gap: ${SPACE.md};
  }
  .pq-button {
    flex: 1;
    padding: ${SPACE.md};
    border: 0;
    border-radius: ${RADIUS.md};
    background: var(--mc-accent);
    color: var(--mc-bg);
    font-family: inherit;
    font-size: ${TYPE.body.size};
    font-weight: ${WEIGHT.semibold};
    cursor: pointer;
  }
  .pq-button:disabled { opacity: 0.6; cursor: default; }
  .pq-cancel {
    padding: ${SPACE.md};
    border: 0;
    background: none;
    color: var(--mc-muted);
    font-family: inherit;
    font-size: ${TYPE.body.size};
    cursor: pointer;
  }
`;
