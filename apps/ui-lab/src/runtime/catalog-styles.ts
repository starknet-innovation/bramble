import { RADIUS, SHADOW, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

/**
 * Storybook-only layout for presenting production design-system specimens.
 * Component paint remains entirely owned by the extension stylesheet.
 */
export const CATALOG_STYLES = `
  .catalog-page {
    display: grid;
    gap: 40px;
    margin: 0 auto;
    max-width: 1040px;
    padding: 48px;
    width: 100%;
  }
  .catalog-heading { display: grid; gap: ${SPACE.sm}; max-width: 70ch; }
  .catalog-heading h1 {
    font-size: ${TYPE.headline.size};
    font-weight: ${WEIGHT.heavy};
    letter-spacing: -0.03em;
    line-height: ${TYPE.headline.line};
  }
  .catalog-heading p { color: var(--mc-muted); line-height: 1.6; }
  .catalog-group { display: grid; gap: ${SPACE.lg}; }
  .catalog-group > header { display: grid; gap: ${SPACE.xs}; }
  .catalog-group > header h2 { font-size: ${TYPE.display.size}; }
  .catalog-group > header p { color: var(--mc-muted); max-width: 70ch; }
  .catalog-grid {
    display: grid;
    gap: ${SPACE.lg};
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
  .catalog-grid.wide { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
  .catalog-sample {
    align-content: start;
    background: var(--mc-sunken);
    border-radius: ${RADIUS.lg};
    display: grid;
    gap: ${SPACE.md};
    min-width: 0;
    padding: ${SPACE.lg};
  }
  .catalog-sample > h3 {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    letter-spacing: 0.03em;
  }
  .catalog-row { align-items: center; display: flex; flex-wrap: wrap; gap: ${SPACE.sm}; }
  .catalog-stack { display: grid; gap: ${SPACE.md}; }
  .catalog-swatch {
    background: var(--swatch);
    border-radius: ${RADIUS.md};
    box-shadow: ${SHADOW.xs};
    min-height: 88px;
  }
  .catalog-token-copy { display: grid; gap: ${SPACE.xs}; }
  .catalog-token-copy code { color: var(--mc-muted); }
  .catalog-type-row {
    align-items: baseline;
    display: grid;
    gap: ${SPACE.lg};
    grid-template-columns: minmax(100px, 0.28fr) minmax(0, 1fr);
    padding: ${SPACE.md} 0;
  }
  .catalog-type-row + .catalog-type-row { box-shadow: inset 0 1px 0 var(--mc-hairline); }
  .catalog-type-meta { color: var(--mc-muted); display: grid; font-size: ${TYPE.caption.size}; gap: 2px; }
  .catalog-type-sample[data-type="headline"] { font-size: ${TYPE.headline.size}; font-weight: ${WEIGHT.heavy}; line-height: ${TYPE.headline.line}; }
  .catalog-type-sample[data-type="display"] { font-size: ${TYPE.display.size}; font-weight: ${WEIGHT.bold}; line-height: ${TYPE.display.line}; }
  .catalog-type-sample[data-type="title"] { font-size: ${TYPE.title.size}; font-weight: ${WEIGHT.bold}; line-height: ${TYPE.title.line}; }
  .catalog-type-sample[data-type="body"] { font-size: ${TYPE.body.size}; line-height: ${TYPE.body.line}; }
  .catalog-type-sample[data-type="label"] { font-size: ${TYPE.label.size}; font-weight: ${WEIGHT.medium}; line-height: ${TYPE.label.line}; }
  .catalog-type-sample[data-type="caption"] { color: var(--mc-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
  .catalog-type-sample[data-type="mono"] { font-family: var(--mc-font-mono); font-size: ${TYPE.mono.size}; line-height: ${TYPE.mono.line}; }
  .catalog-space-row { align-items: center; display: flex; gap: ${SPACE.md}; }
  .catalog-space-block { background: var(--mc-accent); border-radius: ${RADIUS.sm}; height: 20px; width: var(--measure); }
  .catalog-radius {
    background: var(--mc-elevated);
    border-radius: var(--radius);
    display: grid;
    min-height: 88px;
    place-items: center;
  }
  .catalog-shadow {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    box-shadow: var(--shadow);
    min-height: 100px;
  }
  .catalog-icon-grid {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  }
  .catalog-icon {
    align-items: center;
    background: var(--mc-sunken);
    border-radius: ${RADIUS.md};
    display: flex;
    gap: ${SPACE.sm};
    min-height: 52px;
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .catalog-icon code { color: var(--mc-muted); font-size: 10px; overflow-wrap: anywhere; }
  .catalog-menu { background: var(--mc-panel); border-radius: ${RADIUS.lg}; overflow: hidden; }
  .catalog-dock-stage .wallet-dock { position: static; }
  .catalog-dock-stage { padding: 0; }
  .catalog-card-limit { margin: 0 auto; max-width: 440px; width: 100%; }
  .catalog-nft-limit { max-width: 280px; }
  .catalog-motion-mark {
    align-items: center;
    background: var(--mc-accent-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent);
    display: inline-flex;
    height: 52px;
    justify-content: center;
    transition: transform 200ms var(--ease-out);
    width: 52px;
  }
  .catalog-motion-mark:hover { transform: translateY(-2px); }
  @media (max-width: 720px) {
    .catalog-page { padding: 28px 20px; }
    .catalog-type-row { grid-template-columns: 1fr; gap: ${SPACE.sm}; }
  }
`;
