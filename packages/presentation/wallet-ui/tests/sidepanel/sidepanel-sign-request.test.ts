/**
 * Sign-request card decoder checks: the pure SNIP-12 typed-data → HTML
 * formatter renders the domain, the primary-type message fields (honoring the
 * declared field list when present, else the raw message keys), nested/struct
 * values as compact JSON, and always emits a raw payload view. Non-record
 * payloads fall back to a single `data` row. Mirrors the pure-builder style of
 * tests/sidepanel/sidepanel-views.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { signRequestDetails } from "../../src/sidepanel/sign-request";

describe("signRequestDetails", () => {
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

    const html = signRequestDetails(typedData);

    // Domain section is present and lists every domain entry.
    expect(html).toContain("Domain");
    expect(html).toContain("chainId");
    expect(html).toContain("MyDapp");
    // The message section header carries the primary type.
    expect(html).toContain("Message · Approve");
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

  test("falls back to the message keys when no field list is declared", () => {
    const typedData = {
      domain: { name: "NoTypes" },
      // `types` has no entry matching primaryType, so isFieldList(...) is false
      // and the renderer uses Object.keys(message).
      message: { first: 1, second: 2 },
      primaryType: "Missing",
      types: {},
    };

    const html = signRequestDetails(typedData);

    expect(html).toContain("Message · Missing");
    expect(html).toContain("first");
    expect(html).toContain("second");
    // Message key order is used verbatim.
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
  });

  test("renders nested struct/array values as compact JSON and null as an em dash", () => {
    const typedData = {
      message: {
        list: [1, 2, 3],
        missing: null,
        nested: { inner: "x" },
      },
      // No primaryType string, so the section header is the bare "Message".
      types: {},
    };

    const html = signRequestDetails(typedData);

    // No "· <type>" suffix when primaryType is absent.
    expect(html).toContain('class="eyebrow">Message</p>');
    expect(html).not.toContain("Message ·");
    // Objects/arrays are stringified (with HTML-escaping applied to the JSON).
    expect(html).toContain("[1,2,3]");
    expect(html).toContain("{&quot;inner&quot;:&quot;x&quot;}");
    // A null/undefined leaf renders as the em-dash placeholder.
    expect(html).toContain("—");
  });

  test("omits an empty domain/message section but still renders the raw view", () => {
    const typedData = { primaryType: "Empty", types: {} };
    const html = signRequestDetails(typedData);

    // Neither domain nor message is present, so no section block is emitted...
    expect(html).not.toContain('class="eyebrow">Domain</p>');
    expect(html).not.toContain("sign-block");
    // ...but the raw payload view is always there.
    expect(html).toContain("Raw typed data");
  });

  test("falls back to a single data row for a non-record payload", () => {
    const html = signRequestDetails("just a string");

    expect(html).toContain('class="sign-block"');
    expect(html).toContain("data");
    expect(html).toContain("just a string");
    // The primary-type message path is not taken for a non-record payload.
    expect(html).not.toContain("Raw typed data");
  });
});
