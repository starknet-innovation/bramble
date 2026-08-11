/**
 * Sign-request card decoder checks: the pure SNIP-12 typed-data → HTML
 * formatter renders the domain, the primary-type message fields in declared
 * order, leaf values as text or compact JSON, and always emits a raw payload
 * view. Non-record payloads fall back to a single `data` row. With no declared
 * field list nothing in the message is hashed, so those keys are carried in the
 * not-signed block instead — the placement invariants for undeclared keys live
 * in tests/sidepanel/sign-request-unhashed-{domain,nested}.test.ts. Mirrors the
 * pure-builder style of tests/sidepanel/sidepanel-views.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { signRequestView } from "../../../../src/sidepanel/shared/sign-request";
import { PRIMARY_TYPE_KEY } from "../../../../src/sidepanel/shared/sign-request-rows";
import {
  SIGNED_MESSAGE_LABEL,
  signBlockBody,
  signHtml,
  UNSIGNED_MESSAGE_LABEL,
} from "../../../support/sign-request-blocks";

describe("signRequestView", () => {
  test("renders domain, primary-type message fields, and a raw view", () => {
    const typedData = {
      domain: { chainId: "SN_MAIN", name: "MyDapp", version: "1" },
      message: { amount: "1000", spender: "0xabc" },
      primaryType: "Approve",
      types: {
        Approve: [
          { name: "spender", type: "felt" },
          { name: "amount", type: "u256" },
        ],
        StarknetDomain: [{ name: "name", type: "shortstring" }],
      },
    };

    const html = signHtml(typedData);

    // Domain section is present and lists every domain entry.
    expect(html).toContain("Domain");
    expect(html).toContain("chainId");
    expect(html).toContain("MyDapp");
    // The section header is the wallet's own fixed word; the site-chosen primary
    // type is reported as a signed row, because the type hash covers it.
    expect(html).toContain(`<p class="eyebrow">${SIGNED_MESSAGE_LABEL}</p>`);
    expect(signBlockBody(html, SIGNED_MESSAGE_LABEL)).toContain(`${PRIMARY_TYPE_KEY}</span>`);
    expect(signBlockBody(html, SIGNED_MESSAGE_LABEL)).toContain("Approve");
    // Fields are emitted in the declared field-list order (spender before
    // amount), which is the reverse of the message object's own key order,
    // proving the field list — not Object.keys — drove the rows.
    expect(html.indexOf("spender")).toBeLessThan(html.indexOf("amount"));
    expect(html).toContain("0xabc");
    expect(html).toContain("1000");
    // The raw typed-data <details> view is always rendered.
    expect(html).toContain("Raw typed data");
    expect(html).toContain("<pre>");
    expect(html).toContain("&quot;primaryType&quot;: &quot;Approve&quot;");
  });

  test("lists the message keys as not signed when no field list is declared", () => {
    const typedData = {
      domain: { name: "NoTypes" },
      // `types` has no entry matching primaryType, so nothing in the message
      // reaches the hash and the signing boundary refuses the envelope.
      message: { first: 1, second: 2 },
      primaryType: "Missing",
      types: {},
    };

    const html = signHtml(typedData);

    // No signed message block at all — only the not-signed one, and the primary
    // type is reported there too, since an undeclared one hashes nothing.
    expect(signBlockBody(html, SIGNED_MESSAGE_LABEL)).toBeUndefined();
    expect(signBlockBody(html, UNSIGNED_MESSAGE_LABEL)).toContain("Missing");
    expect(html).toContain("first");
    expect(html).toContain("second");
    // Message key order is used verbatim.
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
  });

  test("an object parked under a leaf type is never shown as signed", () => {
    // `encodeValue` hashes a `felt` by coercing the value to a field element,
    // which an object or an array is not — so nothing about such a value is
    // covered by the signature and it must not sit in the signed block. A
    // declared field the site simply omitted still renders there, as a blank,
    // so a site cannot quietly drop a field its own type says is signed.
    const typedData = {
      message: { content: [1, 2, 3], missing: null, nested: { inner: "x" } },
      primaryType: "Message",
      types: {
        Message: [
          { name: "content", type: "felt" },
          { name: "missing", type: "felt" },
          { name: "nested", type: "felt" },
        ],
      },
    };

    const view = signRequestView(typedData);

    expect(view.html).toContain(`class="eyebrow">${SIGNED_MESSAGE_LABEL}</p>`);
    // Objects/arrays are stringified and HTML-escaped, in the not-signed block.
    const unsigned = signBlockBody(view.html, UNSIGNED_MESSAGE_LABEL);
    expect(unsigned).toContain("[1,2,3]");
    expect(unsigned).toContain("{&quot;inner&quot;:&quot;x&quot;}");
    // A null/undefined leaf renders as the em-dash placeholder, still signed.
    expect(signBlockBody(view.html, SIGNED_MESSAGE_LABEL)).toContain("—");
    // The decoder cannot say what such a payload would commit to, so the card
    // is told not to offer signing at all.
    expect(view.classified).toBe(false);
  });

  test("emits no signed message block when primaryType is absent", () => {
    const html = signHtml({ message: { anything: 1 }, types: {} });

    // Nothing is hashed without a primary type, so only the not-signed block is
    // emitted — and it carries no primary-type row, because there is none.
    expect(html).toContain(`class="eyebrow">${UNSIGNED_MESSAGE_LABEL}</p>`);
    expect(html).not.toContain(`class="eyebrow">${SIGNED_MESSAGE_LABEL}</p>`);
    expect(html).not.toContain(PRIMARY_TYPE_KEY);
  });

  test("omits an empty domain/message section but still renders the raw view", () => {
    const typedData = { primaryType: "Empty", types: {} };
    const html = signHtml(typedData);

    // Neither domain nor message is present, so no section block is emitted...
    expect(html).not.toContain('class="eyebrow">Domain</p>');
    expect(html).not.toContain("sign-block");
    // ...but the raw payload view is always there.
    expect(html).toContain("Raw typed data");
  });

  test("falls back to a single data row for a non-record payload", () => {
    const view = signRequestView("just a string");

    expect(view.html).toContain('class="sign-block"');
    expect(view.html).toContain("data");
    expect(view.html).toContain("just a string");
    // The primary-type message path is not taken for a non-record payload.
    expect(view.html).not.toContain("Raw typed data");
    // Nothing about a non-envelope can be described as signed.
    expect(view.classified).toBe(false);
  });
});
