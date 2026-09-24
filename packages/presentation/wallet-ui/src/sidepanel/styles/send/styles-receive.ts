/**
 * Receive layer: the QR, the address as its own copy control, and the identity
 * block behind the Advanced switch. Receiving needs one address; the contact card
 * and the coordination keys serve multisig and stay out of the way until asked
 * for.
 */
import { CONTROL, RADIUS, SPACE, TYPE } from "@bramble/ui-kit/tokens";

/**
 * Receive stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const RECEIVE_STYLES = `
  .receive-address-view {
    gap: ${SPACE.md};
    min-width: 0;
  }
  .receive-address-view .qr-card { width: min(204px, 100%); }
  .receive-intro {
    display: grid;
    gap: ${SPACE.xs};
    text-align: center;
  }
  .receive-intro h2 { font-size: ${TYPE.title.size}; margin: 0; }
  .receive-intro p {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
    margin: 0;
  }
  /* The address is shown whole and wraps by CSS only, so what is selected and
     copied is the exact canonical string — never an ellipsised one. */
  .receive-intro .receive-address-line { color: var(--bramble-text); }
  .receive-address-line code {
    display: block;
    line-height: ${TYPE.caption.line};
    overflow-wrap: anywhere;
    user-select: all;
    word-break: break-all;
  }
  .receive-payload-switch { width: 100%; }
  .receive-card-explainer { margin: 0; text-align: center; }
  .receive-actions {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }
  .receive-actions button { min-width: 0; padding-inline: ${SPACE.sm}; text-wrap: nowrap; }
  details.receive-identity {
    background: transparent;
    border-radius: 0;
    border-top: 1px solid var(--bramble-hairline);
  }
  /* Flush section inside the receive card: the summary carries its own
     rounded hover, inset by the section's own gutter, since this details is
     not a clipped panel. */
  details.receive-identity > summary {
    border-radius: ${RADIUS.md};
    margin: 0 -${SPACE.sm};
    padding: 0 ${SPACE.sm};
  }
  .receive-identity .disclosure-body {
    gap: ${SPACE.md};
    padding: ${SPACE.sm} 0 0;
  }
  .receive-identity .disclosure-body::before { display: none; }
  .receive-key-row {
    align-items: center;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: minmax(0, 1fr) auto;
    min-height: ${CONTROL.hit};
  }
  .receive-key-row + .receive-key-row {
    border-top: 1px solid var(--bramble-hairline);
    padding-top: ${SPACE.md};
  }
  .receive-key-row > strong { font-size: ${TYPE.label.size}; }
  .receive-key-row > [data-nostr-key-status] {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
    text-align: right;
  }
  .receive-address-view[data-wallet-card-state="unavailable"] .receive-key-row > [data-nostr-key-status] {
    grid-column: 1 / -1;
    text-align: left;
  }
  .receive-key-value {
    align-items: center;
    display: inline-flex;
    gap: ${SPACE.xs};
    justify-self: end;
    min-width: 0;
  }
  .receive-key-value code {
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    text-wrap: nowrap;
    word-break: normal;
  }
  .receive-card-pending {
    align-items: center;
    color: inherit;
    display: flex;
    justify-content: center;
    margin: 0;
    min-height: 188px;
    opacity: 0.62;
    padding: ${SPACE.lg};
    text-align: center;
  }
  /* The address IS the copy control: a full-width quiet row with the mark on
     the right, so what you tap and what you get are the same thing. */
  button.receive-address-copy {
    align-items: center;
    background: var(--bramble-sunken);
    border-radius: ${RADIUS.md};
    color: var(--bramble-text);
    display: flex;
    gap: ${SPACE.sm};
    justify-content: space-between;
    padding: ${SPACE.sm} ${SPACE.md};
    width: 100%;
  }
  button.receive-address-copy code {
    font-family: var(--bramble-font-mono);
    font-size: ${TYPE.mono.size};
    min-width: 0;
    overflow-wrap: anywhere;
    text-align: start;
    word-break: break-word;
  }
  .receive-address-copy-mark { color: var(--bramble-muted); display: inline-flex; flex: none; }
  .receive-address-copy-mark .icon { height: 16px; width: 16px; }
  @media (hover: hover) and (pointer: fine) {
    button.receive-address-copy:not(:disabled):hover { background: var(--bramble-hover); }
  }
  button.receive-address-copy:not(:disabled):active { background: var(--bramble-soft-press); }
  .receive-advanced-fields { display: grid; gap: ${SPACE.md}; }
  .receive-advanced-fields[hidden] { display: none; }
`;
