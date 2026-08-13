/**
 * Renders a SNIP-12 typed-data request for the sign approval card so the user
 * can read exactly what a site is asking them to sign: the domain, the primary
 * type, every message field, and the raw payload.
 *
 * Which of those values the signed hash actually covers is decided by
 * `./sign-request-decode`, which resolves each value against the payload's own
 * type declarations; this module only lays the two resulting groups out, with
 * anything the hash does not cover in a separate, unmistakably labelled block
 * so it can never read as part of what is signed. When the decoder cannot place
 * a value at all, the view says so through `classified: false` and the card
 * withholds the approve affordance rather than showing a partial view the user
 * might trust.
 *
 * This is a pure view over untrusted input: it renders whatever it is handed,
 * including payloads the hashing boundary in `@mc-wallet/starknet/typed-data`
 * refuses, and never decides whether a request may be signed.
 */
import { escapeHtml } from "@mc-wallet/core/html";
import { isRecord } from "@mc-wallet/core/json";
import { RADIUS, SPACE, TYPE } from "@mc-wallet/ui-kit/tokens";
import { decodeSignRequest } from "./sign-request-decode";
import type { SignRequestRow, SignRequestSplit } from "./sign-request-rows";
import { SIGN_ROW_LIMIT, signRawText, signValueText } from "./sign-request-text";

/**
 * Sign-request card styles, kept beside the renderer so the side panel
 * stylesheet composes them in and stays within its size budget.
 */
export const SIGN_REQUEST_STYLES = `
  .sign-block {
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    display: grid;
    gap: 6px;
    margin-bottom: ${SPACE.sm};
    /* Bounded like the raw block below: an unbounded list of site-supplied rows
       would scroll its own "NOT signed" banner out of view and push the decision
       controls arbitrarily far down the card. */
    max-height: 240px;
    overflow: auto;
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .sign-unsigned { border-left: 3px solid var(--mc-danger); }
  .sign-more { color: var(--mc-muted); font-size: ${TYPE.caption.size}; font-style: italic; }
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

/**
 * The one warning shown when the decoder could not establish what a payload's
 * signed hash would cover. The card renders it in place of the approve control,
 * so the two can never disagree about whether signing is on offer.
 */
export const SIGN_REQUEST_UNCLASSIFIED_WARNING =
  "This wallet could not work out which parts of this message would actually be signed, so it will not offer to sign it. Deny this request and ask the site to send a standard SNIP-12 message.";

/**
 * A rendered sign request: the card body, and whether every value in the
 * payload could be placed as covered or not covered by the signed hash. A caller
 * must not present an approve affordance when `classified` is false.
 */
export type SignRequestView = {
  readonly classified: boolean;
  readonly html: string;
};

const row = ([key, value]: SignRequestRow): string =>
  `<div class="sign-row"><span class="sign-key">${escapeHtml(key)}</span><span class="sign-val">${escapeHtml(signValueText(value))}</span></div>`;

// Only unsigned, site-supplied extras are row-capped. Signed rows live in a
// height-bounded scrolling block and must all remain inspectable there: hiding
// one behind raw JSON would separate the consent surface from the signed hash.
const cappedRows = (entries: readonly SignRequestRow[]): string => {
  const shown = entries.slice(0, SIGN_ROW_LIMIT);
  const hidden = entries.length - shown.length;
  const overflow =
    hidden > 0
      ? `<div class="sign-row sign-more">${hidden} more values not shown — see Raw typed data</div>`
      : "";
  return `${shown.map(row).join("")}${overflow}`;
};

const signedRows = (entries: readonly SignRequestRow[]): string => entries.map(row).join("");

// Section labels are fixed strings, never interpolated from the payload: a
// site-chosen `primaryType` such as "shown by the site but NOT signed" would
// otherwise reproduce the not-signed banner verbatim over the signed block, and
// the banner is the whole mitigation. The primary type is reported as a row
// inside the block instead (`PRIMARY_TYPE_KEY`).
const section = (label: string, body: string, modifier = ""): string =>
  body.length === 0
    ? ""
    : `<p class="eyebrow">${escapeHtml(label)}</p><div class="sign-block${modifier}">${body}</div>`;

const unsignedSection = (label: string, split: SignRequestSplit): string =>
  section(
    `${label} — shown by the site but NOT signed`,
    cappedRows(split.unsigned),
    " sign-unsigned",
  );

/**
 * Renders the decoded domain, primary-type message fields, and a raw view of a
 * SNIP-12 typed-data payload, resolving every value against the payload's own
 * type declarations so undeclared — and therefore unsigned — keys are never
 * shown as signed content. A payload that is not an envelope at all falls back
 * to a single raw row and is reported unclassified, because nothing about it
 * can be described as signed.
 */
export const signRequestView = (typedData: unknown): SignRequestView => {
  if (!isRecord(typedData)) {
    return {
      classified: false,
      html: `<div class="sign-block">${cappedRows([["data", typedData]])}</div>`,
    };
  }
  const decoded = decodeSignRequest(typedData);
  const raw = escapeHtml(signRawText(JSON.stringify(typedData, null, 2) ?? ""));
  return {
    classified: !decoded.domain.unclassified && !decoded.message.unclassified,
    html: `
    ${section("Domain", signedRows(decoded.domain.signed))}
    ${unsignedSection("Domain", decoded.domain)}
    ${section("Message", signedRows(decoded.message.signed))}
    ${unsignedSection("Message", decoded.message)}
    <details class="sign-raw"><summary>Raw typed data</summary><pre>${raw}</pre></details>`,
  };
};
