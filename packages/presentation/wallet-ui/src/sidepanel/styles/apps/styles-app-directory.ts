/**
 * App directory styles (mc-wallet issue 749): the listed-app line on an
 * approval card, the directory screen's filters and rows, and the listed mark
 * on an Activity row. Green is the positive role, so a listing reads as a good
 * sign without borrowing the accent.
 */
import { RADIUS, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

/**
 * App directory fragment consumed by SIDEPANEL_STYLES.
 */
export const APP_DIRECTORY_STYLES = `
  .request-listed,
  .tx-listed-name {
    align-items: center;
    color: var(--bramble-positive);
    display: inline-flex;
    font-size: ${TYPE.micro.size};
    font-weight: ${WEIGHT.medium};
    gap: ${SPACE.xs};
    overflow-wrap: anywhere;
  }
  .request-listed .icon { flex: none; height: 12px; width: 12px; }
  .tx-listed-name { display: flex; margin-top: ${SPACE.xxs}; }
  .tx-listed { color: var(--bramble-positive); display: inline-flex; flex: none; }
  .tx-listed .icon { height: 14px; width: 14px; }
  .app-filters {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: minmax(0, 1fr) minmax(0, 9rem);
    margin-bottom: ${SPACE.md};
  }
  .app-list { display: grid; gap: ${SPACE.xs}; list-style: none; margin: 0; padding: 0; }
  .app-list > li[hidden] { display: none; }
  .app-entry {
    align-items: center;
    border-radius: ${RADIUS.md};
    color: var(--bramble-text);
    display: flex;
    gap: ${SPACE.md};
    min-width: 0;
    padding: ${SPACE.sm} ${SPACE.md};
    text-decoration: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .app-entry:hover { background: var(--bramble-sunken); }
  }
  .app-entry > .icon { color: var(--bramble-muted); flex: none; }
  .app-entry-copy { display: grid; flex: 1; gap: ${SPACE.xxs}; min-width: 0; }
  .app-entry-copy strong { font-size: ${TYPE.body.size}; overflow-wrap: anywhere; }
  .app-entry-copy .hint { overflow-wrap: anywhere; }
  .app-connected {
    align-items: center;
    color: var(--bramble-muted);
    display: inline-flex;
    flex: none;
    font-size: ${TYPE.micro.size};
    gap: ${SPACE.xxs};
  }
  .app-connected .icon { height: 12px; width: 12px; }
`;
