/**
 * Decodes a SNIP-12 typed-data request for the sign approval card so the user
 * can read exactly what a site is asking them to sign: the domain, the primary
 * type, every message field, and the raw payload.
 */
import { escapeHtml } from "../shared/html";
import { RADIUS, SPACE, TYPE } from "../ui/tokens";

/**
 * Sign-request card styles, kept beside the decoder so the side panel
 * stylesheet composes them in and stays within its size budget.
 */
export const SIGN_REQUEST_STYLES = `
  .sign-block {
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge);
    display: grid;
    gap: 6px;
    margin-bottom: ${SPACE.sm};
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .sign-row { align-items: baseline; display: flex; gap: ${SPACE.md}; justify-content: space-between; }
  .sign-key { color: var(--mc-muted); flex: none; font-size: ${TYPE.caption.size}; }
  .sign-val {
    font-family: var(--mc-font-mono);
    font-size: ${TYPE.caption.size};
    overflow-wrap: anywhere;
    text-align: right;
  }
  .sign-raw { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
  .sign-raw summary { cursor: pointer; }
  .sign-raw pre {
    background: var(--mc-bg);
    border-radius: ${RADIUS.sm};
    font-size: ${TYPE.mono.size};
    margin: ${SPACE.xs} 0 0;
    max-height: 200px;
    overflow: auto;
    padding: ${SPACE.sm};
  }`;

type Field = { readonly name: string; readonly type: string };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const isFieldList = (value: unknown): value is readonly Field[] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      asRecord(entry) !== null &&
      typeof (entry as Field).name === "string" &&
      typeof (entry as Field).type === "string",
  );

// Renders a leaf value: primitives as text, structs/arrays as compact JSON.
const valueText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
};

const rows = (entries: readonly (readonly [string, unknown])[]): string =>
  entries
    .map(
      ([key, value]) =>
        `<div class="sign-row"><span class="sign-key">${escapeHtml(key)}</span><span class="sign-val">${escapeHtml(valueText(value))}</span></div>`,
    )
    .join("");

const section = (label: string, body: string): string =>
  body.length === 0
    ? ""
    : `<p class="eyebrow">${escapeHtml(label)}</p><div class="sign-block">${body}</div>`;

/**
 * Renders the decoded domain, primary-type message fields, and a raw view of a
 * SNIP-12 typed-data payload. Falls back gracefully for non-standard shapes.
 */
export const signRequestDetails = (typedData: unknown): string => {
  const record = asRecord(typedData);
  if (!record) {
    return `<div class="sign-block">${rows([["data", typedData]])}</div>`;
  }
  const domain = asRecord(record["domain"]);
  const message = asRecord(record["message"]);
  const types = asRecord(record["types"]);
  const primaryType = typeof record["primaryType"] === "string" ? record["primaryType"] : "";
  const fieldList = types && isFieldList(types[primaryType]) ? types[primaryType] : null;

  const domainRows = domain ? rows(Object.entries(domain)) : "";
  const messageRows = message
    ? rows(
        (fieldList ? fieldList.map((field) => field.name) : Object.keys(message)).map(
          (name) => [name, message[name]] as const,
        ),
      )
    : "";

  const raw = escapeHtml(JSON.stringify(typedData, null, 2));
  return `
    ${section("Domain", domainRows)}
    ${section(primaryType ? `Message · ${primaryType}` : "Message", messageRows)}
    <details class="sign-raw"><summary>Raw typed data</summary><pre>${raw}</pre></details>`;
};
