export const LAB_STYLES = `
  :root {
    color-scheme: dark;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; }
  button, input, select, textarea { font: inherit; }
  button { cursor: pointer; }
  .ui-lab {
    --lab-accent: #5c8dff;
    --lab-border: #262c38;
    --lab-elevated: #181d26;
    --lab-muted: #96a2b5;
    --lab-panel: #11151c;
    --lab-positive: #2fcf8e;
    --lab-sunken: #090c12;
    --lab-text: #f2f5fa;
    background: var(--lab-sunken);
    color: var(--lab-text);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 100vh;
  }
  .lab-topbar {
    align-items: center;
    background: color-mix(in srgb, var(--lab-panel) 94%, transparent);
    border-bottom: 1px solid var(--lab-border);
    display: flex;
    gap: 20px;
    justify-content: space-between;
    min-height: 68px;
    padding: 12px 20px;
    position: sticky;
    top: 0;
    z-index: 4;
  }
  .lab-brand { align-items: center; display: flex; gap: 12px; min-width: 0; }
  .lab-mark {
    align-items: center;
    background: var(--lab-accent);
    border-radius: 11px;
    color: #0a1220;
    display: inline-flex;
    flex: none;
    font-weight: 850;
    height: 38px;
    justify-content: center;
    letter-spacing: -0.06em;
    width: 38px;
  }
  .lab-brand-copy { display: grid; gap: 1px; }
  .lab-brand strong { font-size: 14px; letter-spacing: -0.01em; }
  .lab-brand span, .lab-meta { color: var(--lab-muted); font-size: 11px; }
  .lab-brand .lab-mark { color: #0a1220; }
  .lab-top-controls { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
  .lab-field { display: grid; gap: 4px; }
  .lab-field > span {
    color: var(--lab-muted);
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .lab-select, .lab-button, .lab-segment button, .checkpoint-button {
    background: var(--lab-elevated);
    border: 1px solid var(--lab-border);
    border-radius: 9px;
    color: var(--lab-text);
    min-height: 34px;
  }
  .lab-select { min-width: 180px; padding: 0 30px 0 11px; }
  .lab-button { align-items: center; display: inline-flex; gap: 6px; justify-content: center; padding: 0 11px; }
  .lab-button:hover, .lab-segment button:hover, .checkpoint-button:hover {
    border-color: color-mix(in srgb, var(--lab-accent) 55%, var(--lab-border));
  }
  .lab-button:focus-visible, .lab-select:focus-visible, .lab-segment button:focus-visible,
  .checkpoint-button:focus-visible, .feedback-input:focus-visible {
    outline: 2px solid var(--lab-accent);
    outline-offset: 2px;
  }
  .lab-button.primary {
    background: var(--lab-accent);
    border-color: var(--lab-accent);
    color: #0a1220;
    font-weight: 750;
  }
  .lab-button[disabled] { cursor: default; opacity: 0.44; }
  .lab-main {
    display: grid;
    gap: 18px;
    grid-template-columns: minmax(440px, 1fr) minmax(320px, 390px);
    min-height: 0;
    padding: 18px;
  }
  .lab-stage {
    align-content: start;
    background: #0d1118;
    border: 1px solid var(--lab-border);
    border-radius: 16px;
    display: grid;
    gap: 14px;
    justify-items: center;
    min-width: 0;
    overflow: auto;
    padding: 20px;
  }
  .stage-heading {
    align-items: end;
    display: flex;
    gap: 20px;
    justify-content: space-between;
    max-width: 960px;
    width: 100%;
  }
  .stage-copy { display: grid; gap: 4px; min-width: 0; }
  .stage-copy p { color: var(--lab-muted); font-size: 12px; line-height: 1.5; margin: 0; }
  .stage-copy h1 { font-size: 18px; letter-spacing: -0.02em; margin: 0; }
  .fixture-badge {
    align-items: center;
    background: color-mix(in srgb, var(--lab-positive) 12%, var(--lab-panel));
    border: 1px solid color-mix(in srgb, var(--lab-positive) 28%, var(--lab-border));
    border-radius: 999px;
    color: var(--lab-positive);
    display: inline-flex;
    flex: none;
    font-size: 10px;
    font-weight: 760;
    gap: 6px;
    padding: 6px 9px;
    text-transform: uppercase;
  }
  .fixture-dot { background: currentColor; border-radius: 50%; height: 6px; width: 6px; }
  .device-stand {
    align-items: start;
    display: grid;
    justify-items: center;
    min-height: 0;
    padding: 2px 24px 30px;
    position: relative;
    width: 100%;
  }
  .device-stand::after {
    background: #05070a;
    border-radius: 50%;
    bottom: 14px;
    content: "";
    filter: blur(9px);
    height: 14px;
    opacity: 0.72;
    position: absolute;
    width: min(420px, 80%);
  }
  .wallet-device {
    background: #05070a;
    border: 1px solid #303745;
    border-radius: 18px;
    box-shadow: 0 18px 45px rgb(0 0 0 / 36%);
    display: grid;
    padding: 7px;
    position: relative;
    z-index: 1;
  }
  .wallet-device[data-surface="sidepanel"] { height: 760px; width: 400px; }
  .wallet-device[data-surface="popup"] { height: 600px; width: 380px; }
  .wallet-device[data-surface="fullpage"] { height: 800px; width: 960px; }
  .wallet-frame {
    background: #0b0e13;
    border: 0;
    border-radius: 11px;
    height: 100%;
    width: 100%;
  }
  .device-label {
    bottom: 3px;
    color: var(--lab-muted);
    font: 600 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    left: 50%;
    position: absolute;
    transform: translateX(-50%);
  .lab-rail { display: grid; gap: 12px; min-width: 0; }
  .lab-card {
    background: var(--lab-panel);
    border: 1px solid var(--lab-border);
    border-radius: 13px;
    display: grid;
    gap: 12px;
    padding: 14px;
  }
  .lab-card h2, .lab-card h3 { margin: 0; }
  .lab-card h2 { font-size: 15px; letter-spacing: -0.01em; }
  .lab-card h3, .lab-kicker {
    color: var(--lab-muted);
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.08em;
    margin: 0;
    text-transform: uppercase;
  }
  .checkpoint-copy { color: var(--lab-muted); font-size: 12px; line-height: 1.55; margin: 0; }
  .transport-row { display: grid; gap: 8px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .transport-row .lab-button { padding: 0 7px; }
  .lab-segment {
    background: var(--lab-sunken);
    border-radius: 10px;
    display: grid;
    gap: 3px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 3px;
  }
  .lab-segment button { background: transparent; border-color: transparent; font-size: 11px; }
  .lab-segment button[aria-pressed="true"] {
    background: var(--lab-elevated);
    border-color: var(--lab-border);
  }
  .tuning-grid { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
  .reduced-toggle { align-items: center; color: var(--lab-muted); display: flex; font-size: 11px; gap: 8px; }
  .checkpoint-list { display: grid; gap: 6px; }
  .checkpoint-button {
    align-items: center;
    display: grid;
    font-size: 11px;
    gap: 8px;
    grid-template-columns: 22px 1fr;
    padding: 7px 9px;
    text-align: left;
  }
  .checkpoint-button span:first-child {
    align-items: center;
    background: var(--lab-sunken);
    border-radius: 6px;
    color: var(--lab-muted);
    display: inline-flex;
    font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    height: 22px;
    justify-content: center;
  }
  .checkpoint-button[aria-current="step"] {
    background: color-mix(in srgb, var(--lab-accent) 11%, var(--lab-elevated));
    border-color: color-mix(in srgb, var(--lab-accent) 58%, var(--lab-border));
  }
  .checkpoint-button[aria-current="step"] span:first-child {
    background: var(--lab-accent);
    color: #0a1220;
  }
  .evidence-grid { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
  .event-log, .state-view {
    background: var(--lab-sunken);
    border: 1px solid var(--lab-border);
    border-radius: 9px;
    color: var(--lab-muted);
    font: 10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
    margin: 0;
    max-height: 180px;
    min-height: 122px;
    overflow: auto;
    padding: 9px;
    white-space: pre-wrap;
  }
  .event-list { display: grid; gap: 5px; list-style: none; margin: 0; padding: 0; }
  .event-list li { display: grid; gap: 6px; grid-template-columns: 22px 48px 1fr; }
  .event-list .event-index { color: #7f8a9d; }
  .event-list .event-kind { color: var(--lab-accent); }
  .feedback-input {
    background: var(--lab-sunken);
    border: 1px solid var(--lab-border);
    border-radius: 9px;
    color: var(--lab-text);
    min-height: 74px;
    padding: 9px 10px;
    resize: vertical;
    width: 100%;
  }
  .feedback-actions { display: flex; gap: 8px; justify-content: space-between; }
  .feedback-count { align-self: center; color: var(--lab-muted); font-size: 10px; }
  .lab-error {
    background: color-mix(in srgb, #f87171 11%, var(--lab-panel));
    border: 1px solid color-mix(in srgb, #f87171 34%, var(--lab-border));
    border-radius: 9px;
    color: #fca5a5;
    font-size: 11px;
    padding: 9px;
  }
  @media (max-width: 980px) {
    .lab-main { grid-template-columns: 1fr; }
    .lab-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .lab-card:first-child, .lab-card:last-child { grid-column: 1 / -1; }
  }
  @media (max-width: 620px) {
    .lab-topbar { align-items: stretch; flex-direction: column; }
    .lab-top-controls { display: grid; grid-template-columns: 1fr 1fr; }
    .lab-select { min-width: 0; width: 100%; }
    .lab-main { padding: 10px; }
    .lab-stage { padding: 12px 4px; }
    .device-stand { overflow: auto; padding-inline: 8px; }
    .lab-rail { grid-template-columns: 1fr; }
    .lab-card:first-child, .lab-card:last-child { grid-column: auto; }
    .evidence-grid { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    .wallet-device { transition: none; }
  }
`;
