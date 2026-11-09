/**
 * MCW-V09-104 regression: the sign card must not present unhashed domain fields
 * as part of the signature.
 *
 * The domain object a site sends is not the domain that gets hashed — only the
 * fields its `StarknetDomain`/`StarkNetDomain` type declares reach the domain
 * struct. Rendering the raw object let a site display `chainId: SN_MAIN` beside
 * a payload that hashes identically on Sepolia. These tests pin that every row
 * in the Domain block is a hashed field, and that anything else is carried in a
 * separate, unmistakably labelled block.
 */
import { describe, expect, test } from "bun:test";
import { typedDataHash } from "@bramble/starknet/typed-data";
import {
  signBlockBody,
  signHtml,
  UNSIGNED_DOMAIN_LABEL as UNSIGNED_LABEL,
} from "../../../support/sign-request-blocks";

describe("sign card domain rows", () => {
  test("an undeclared chainId is separated out, not shown as signed domain", () => {
    // `chainId` is absent from StarknetDomain, so SN_MAIN and SN_SEPOLIA give
    // the same message hash — the user must not read it as signed context.
    const typedData = {
      domain: { chainId: "SN_MAIN", name: "MyDapp", revision: "1", version: "1" },
      message: { amount: "1000" },
      primaryType: "Approve",
      types: {
        Approve: [{ name: "amount", type: "u256" }],
        StarknetDomain: [
          { name: "name", type: "shortstring" },
          { name: "version", type: "shortstring" },
          { name: "revision", type: "shortstring" },
        ],
      },
    };

    const html = signHtml(typedData);

    const signed = signBlockBody(html, "Domain");
    expect(signed).toBeDefined();
    expect(signed).toContain("MyDapp");
    // The signed block carries only declared fields.
    expect(signed).not.toContain("chainId");
    expect(signed).not.toContain("SN_MAIN");

    const unsigned = signBlockBody(html, UNSIGNED_LABEL);
    expect(unsigned).toBeDefined();
    expect(unsigned).toContain("chainId");
    expect(unsigned).toContain("SN_MAIN");
    // The unsigned block does not repeat hashed fields.
    expect(unsigned).not.toContain("MyDapp");
  });

  test("the two chain spellings that hash alike render identically apart from the unsigned block", () => {
    const withChain = (chainId: string): unknown => ({
      domain: { chainId, name: "MyDapp", revision: "1", version: "1" },
      message: { amount: "1000" },
      primaryType: "Approve",
      types: {
        Approve: [{ name: "amount", type: "u256" }],
        StarknetDomain: [{ name: "name", type: "shortstring" }],
      },
    });

    const mainnet = signHtml(withChain("SN_MAIN"));
    const sepolia = signHtml(withChain("SN_SEPOLIA"));

    // Same signed domain block for both, because chainId never reaches it.
    expect(signBlockBody(mainnet, "Domain")).toBe(signBlockBody(sepolia, "Domain") as string);
    // And each names its own chain only in the not-signed block.
    expect(signBlockBody(mainnet, UNSIGNED_LABEL)).toContain("SN_MAIN");
    expect(signBlockBody(sepolia, UNSIGNED_LABEL)).toContain("SN_SEPOLIA");
  });

  test("with no domain type declared, nothing in the domain is shown as signed", () => {
    const html = signHtml({
      domain: { chainId: "SN_MAIN", name: "MyDapp", version: "1" },
      message: { content: "hi" },
      primaryType: "Message",
      types: { Message: [{ name: "content", type: "felt" }] },
    });

    // No StarknetDomain/StarkNetDomain entry means no domain field is hashed.
    expect(signBlockBody(html, "Domain")).toBeUndefined();
    const unsigned = signBlockBody(html, UNSIGNED_LABEL);
    expect(unsigned).toContain("chainId");
    expect(unsigned).toContain("MyDapp");
    expect(unsigned).toContain("version");
  });

  test("a fully declared domain renders no not-signed block at all", () => {
    const html = signHtml({
      domain: { chainId: "SN_MAIN", name: "MyDapp", revision: "1", version: "1" },
      message: { content: "hi" },
      primaryType: "Message",
      types: {
        Message: [{ name: "content", type: "felt" }],
        StarknetDomain: [
          { name: "name", type: "shortstring" },
          { name: "version", type: "shortstring" },
          { name: "chainId", type: "shortstring" },
          { name: "revision", type: "shortstring" },
        ],
      },
    });

    expect(signBlockBody(html, "Domain")).toContain("SN_MAIN");
    expect(html).not.toContain(UNSIGNED_LABEL);
  });

  test("a declared domain field the site omitted still renders, as a blank", () => {
    // Hiding it would let a site drop a field the type says is signed.
    const html = signHtml({
      domain: { name: "MyDapp", revision: "1" },
      message: {},
      primaryType: "Message",
      types: {
        Message: [],
        StarknetDomain: [
          { name: "name", type: "shortstring" },
          { name: "chainId", type: "shortstring" },
        ],
      },
    });

    const signed = signBlockBody(html, "Domain");
    expect(signed).toContain("chainId");
    expect(signed).toContain("—");
  });

  test("the legacy revision 0 domain spelling is decoded against its own struct", () => {
    // Revision 0 is signable again (MCW-V09-101), so the legacy spelling is the
    // struct the hash actually covers, not merely a shape this view tolerates.
    const html = signHtml({
      domain: { chainId: "SN_MAIN", name: "MyDapp", version: "1" },
      message: { content: "hi" },
      primaryType: "Message",
      types: {
        Message: [{ name: "content", type: "felt" }],
        StarkNetDomain: [{ name: "name", type: "felt" }],
      },
    });

    expect(signBlockBody(html, "Domain")).toContain("MyDapp");
    expect(signBlockBody(html, UNSIGNED_LABEL)).toContain("SN_MAIN");
  });

  test("with both spellings declared, the revision picks which one is shown as signed", () => {
    // A payload may legitimately declare both domain structs, but only the one
    // its revision selects reaches the hash. Reading the richer declaration on a
    // revision 0 payload would put a `chainId` row in the signed block that the
    // hash never covered — the same class of lie as an undeclared domain key.
    const base = {
      domain: { name: "MyDapp" },
      message: { content: "0x1" },
      primaryType: "Message",
    };
    const legacyOnly = {
      ...base,
      types: {
        Message: [{ name: "content", type: "felt" }],
        StarkNetDomain: [{ name: "name", type: "felt" }],
      },
    };
    const bothSpellings = {
      ...base,
      types: {
        ...legacyOnly.types,
        // Inert on revision 0, and the richer of the two declarations.
        StarknetDomain: [
          { name: "name", type: "shortstring" },
          { name: "chainId", type: "shortstring" },
        ],
      },
    };
    const account = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

    // The extra declaration contributes nothing: both hash identically.
    expect(typedDataHash(bothSpellings, account)).toBe(typedDataHash(legacyOnly, account));

    const html = signHtml(bothSpellings);
    expect(signBlockBody(html, "Domain")).toContain("MyDapp");
    expect(signBlockBody(html, "Domain")).not.toContain("chainId");
    // Nothing is left over either, so the card is not merely hiding the row.
    expect(html).not.toContain(UNSIGNED_LABEL);
  });
});
